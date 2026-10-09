# Production deployment

The portal runs as three long-running containers plus a one-shot migration job on one Linux server, defined in `docker-compose.prod.yml`:

```
Internet ──443/TLS──► caddy ──► app:3000 ──► db:5432
                       (edge network)       (internal network, no internet)
```

- **caddy** — the only container with published ports (80, 443). Gets and renews the Let's Encrypt certificate automatically, compresses responses, limits request bodies to 25 MB.
- **migrate** — runs once on every `up`: applies pending migrations as the database owner and keeps the restricted runtime role `portal_app` up to date, then exits. The app starts only if it succeeded.
- **app** — the Next.js server. Runs as an unprivileged user with a read-only filesystem and no Linux capabilities, and connects to the database as `portal_app`, which can't change the schema and can only add to the audit log (so the append-only trigger can't be switched off from the app). The owner password never reaches this container. Runs an hourly cleanup (expired sessions, rate-limit windows, expired quarantine).
- **db** — PostgreSQL 18, reachable only from the app and the migration job.

Everything the server needs lives in two places: the repository folder with its `.env` (e.g. `/srv/portal`) and three Docker volumes (`pgdata`, `caddy_data`, `caddy_config`).

## 1. Server requirements

| | |
|---|---|
| OS | Ubuntu Server 24.04 or 26.04 LTS, **x86_64** (arm64 works too) |
| Size | 2 vCPU, 4 GB RAM (the image build needs ~2 GB), 20 GB disk |
| Software | Docker Engine with the compose plugin, git |
| DNS | An A (and AAAA, if IPv6) record for the portal host name pointing at the server |
| Inbound | TCP 80 and 443, UDP 443 (HTTP/3) from the internet; SSH only from admin networks |
| Outbound | 443 to `login.microsoftonline.com` (sign-in), `graph.microsoft.com` (only with `FEATURE_EMPLOYEE_ID`), Let's Encrypt, Docker Hub / npm (builds) |

Port 80 must be reachable for the Let's Encrypt HTTP challenge and redirects to HTTPS. If the server must not be reachable from the internet at all, Let's Encrypt can't validate it — use a DNS challenge (custom Caddy build) or your own certificate; ask before going that way.

Install Docker from Docker's repository (not the Ubuntu `docker.io` package):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in
docker compose version
```

## 2. First installation

```bash
sudo mkdir -p /srv/portal && sudo chown "$USER" /srv/portal
git clone <repository-url> /srv/portal
cd /srv/portal
cp .env.production.example .env
chmod 600 .env
```

Fill in `.env` (every variable is explained in the file):

```bash
openssl rand -base64 48                          # BETTER_AUTH_SECRET
openssl rand -hex 24                             # POSTGRES_PASSWORD (owner, migrations only)
openssl rand -hex 24                             # APP_DB_PASSWORD (runtime role)
echo "k$(date +%Y%m):$(openssl rand -base64 32)" # CONFIG_ENC_KEYS (id before ":" → CONFIG_ENC_ACTIVE_KEY_ID)
```

- `PORTAL_HOST` and `BETTER_AUTH_URL` must describe the same host (`portal.example.com` / `https://portal.example.com`).
- `ENTRA_*` come from the app registration ([ENTRA_SETUP.md](ENTRA_SETUP.md)). In the app registration add the redirect URI `https://<PORTAL_HOST>/api/auth/callback/microsoft`.
- `ALLOWED_UPN_DOMAINS` — set exactly one UPN domain (enforced at startup). Owner keys use the part of the UPN before `@`, so a second domain could map two people to one key. Both `BETTER_AUTH_URL` and `ENTRA_AUTHORITY` must be HTTPS origins without paths, credentials, queries or fragments.
- `AUTH_MOCK` must not appear in the file at all — the app refuses to start if it does.
- `SUPPORT_URL` and `APP_TIME_ZONE` customize the support link and displayed dates. All organization-specific settings live in this private environment file; no code changes are needed. See [Configure your organization](../README.md#configure-your-organization).

On an existing installation, edit its current `.env` instead of copying the example over it. Keep the existing encryption keys, database passwords, Compose project name and volumes. After an environment-only change, use `docker compose -f docker-compose.prod.yml up -d --force-recreate --wait` so containers receive the new values; a simple `restart` does not apply changed environment variables.

Start:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps -a     # db/app healthy, caddy running, migrate "Exited (0)"
curl -fsS https://<PORTAL_HOST>/api/health           # {"ok":true}
```

Open the portal, sign in with an account that has **Portal Admin**, and check *Administration → Overview*.

If the app container keeps restarting, `docker compose -f docker-compose.prod.yml logs app` shows the reason — usually a missing or malformed variable; the message names it.

## 3. Back up the secrets — now, before importing anything

| Secret | If it's lost |
|---|---|
| `CONFIG_ENC_KEYS` | **Every stored VPN config is unrecoverable**, including in database backups. Configs must be re-exported and re-imported |
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` | Recoverable (reset inside the database container), but keep them |
| `BETTER_AUTH_SECRET` | Everyone is signed out once; generate a new one |
| `ENTRA_CLIENT_SECRET` | Create a new secret in Entra |

Store a copy of `.env` (or at least `CONFIG_ENC_KEYS`) in the team password manager or a vault — **not** next to the database backups. A stolen database backup alone reveals no config contents and no usable sign-in material (OAuth tokens aren't stored; session tokens are useless without `BETTER_AUTH_SECRET`); a backup together with the key does reveal the configs.

## 4. Database backups

`deploy/backup.sh` writes a compressed `pg_dump` to `/srv/portal-backups`, checks that it is readable and keeps 14 days.

```bash
sudo mkdir -p /srv/portal-backups && sudo chown "$USER" /srv/portal-backups
/srv/portal/deploy/backup.sh                 # run once by hand
crontab -e
# 15 2 * * * /srv/portal/deploy/backup.sh >> /srv/portal-backups/backup.log 2>&1
```

Copy the dumps off the server as well (e.g. `restic` or `rclone` to another location). Config contents in the dumps are encrypted; user names, owner keys and the audit log are not — treat dumps as confidential.

**Restore** (test it at least once a quarter, on a test machine, with the real key):

```bash
cd /srv/portal
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U portal -d portal --clean --if-exists < /srv/portal-backups/portal-YYYYMMDD-HHMMSS.dump
docker compose -f docker-compose.prod.yml up -d          # re-runs migrate (re-grants the runtime role), starts app
```

The restored configs open only with the `CONFIG_ENC_KEYS` that were active when they were imported (or later rotated to).

## 5. Importing configs in production

**Admin UI (recommended):** *Administration → Import* — drag files in, check the preview, import.

Short-UPN filenames and native Pritunl exports still work without entering an Object ID. Stale automatic aliases and known ownership collisions go to quarantine. Manual aliases are an explicit administrative ownership decision. The portal learns UPN changes only at sign-in: before reusing a login, revoke the previous employee's portal sessions and VPN credentials, then review/reassign its owner key. Do not leave pending configs under recycled logins.

OpenVPN imports use an allowlist of canonical options. Before rollout, dry-run sanitized exports from each deployed Pritunl version; an unsupported legitimate option needs review before being added.

**CLI** for large batches. Copy the files to a folder on the server **outside** the repository, then:

```bash
cd /srv/portal
docker compose -f docker-compose.prod.yml run --rm --no-deps -v /srv/portal-inbox:/inbox:ro app \
  node dist/import.mjs /inbox --dry-run
docker compose -f docker-compose.prod.yml run --rm --no-deps -it -v /srv/portal-inbox:/inbox:ro app \
  node dist/import.mjs /inbox
shred -u /srv/portal-inbox/*      # the files contain private keys
```

The folder is mounted read-only, so `--delete-imported` can't work there; delete the files yourself after a successful import. CLI imports are audited as `cli:node` (the container user).

## 6. Updating

```bash
cd /srv/portal
./deploy/backup.sh                                   # always back up before an update
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs migrate        # "Migrations applied." + "Runtime role … up to date."
docker compose -f docker-compose.prod.yml logs --tail=20 app
```

Migrations run in the `migrate` job before the new app container starts; if one fails, the app keeps not starting instead of serving new code on an old schema. Downtime is the few seconds of the container swap.

Base images (Node, Postgres, Caddy) get security fixes through `docker compose -f docker-compose.prod.yml build --pull` followed by `up -d`. A **major** PostgreSQL upgrade (18 → 19) needs a dump and restore into a new volume — don't just change the tag.

**Rolling back:** `git checkout <previous tag or commit>` and `up -d --build`. If the update included a database migration, restore the backup taken before the update as well.

## 7. Rotating secrets

- **Entra client secret** (before it expires): create a new secret in the app registration → put it in `.env` → `docker compose -f docker-compose.prod.yml up -d` → test sign-in → delete the old secret in Entra.
- **Encryption key:** generate a new key → append it to `CONFIG_ENC_KEYS` (comma-separated) and set `CONFIG_ENC_ACTIVE_KEY_ID` to it → `up -d` → re-encrypt old rows:

  ```bash
  docker compose -f docker-compose.prod.yml run --rm --no-deps app node dist/rotate-keys.mjs --dry-run
  docker compose -f docker-compose.prod.yml run --rm --no-deps app node dist/rotate-keys.mjs
  ```

  When it reports nothing left, remove the old key from `CONFIG_ENC_KEYS` and `up -d` again. Keep the old key in the vault until the last backup encrypted with it has expired.
- **`BETTER_AUTH_SECRET`:** replace and `up -d`; everyone signs in again.

## 8. Day-to-day operations

| Task | Command |
|---|---|
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f app` (no config contents are ever logged) |
| Health | `curl -fsS https://<PORTAL_HOST>/api/health` — suitable for uptime monitoring |
| Who downloaded what | *Administration → Audit log* (filter, CSV export) |
| Restart | `docker compose -f docker-compose.prod.yml restart app` |
| Remove someone's access now | Remove the role/assignment in Entra, then *Administration → Users → Sign out everywhere* (otherwise the current session lasts up to `SESSION_MAX_AGE_HOURS`) |
| Edit "How to connect" texts | Edit `content/instructions/<locale>/<type>.md`, then `up -d --build` |

The app writes only temporary files/caches to bounded tmpfs mounts; persistent application data is in PostgreSQL. Compose sets memory/CPU/PID limits (app: 1536 MB / 2 CPUs / 256 PIDs; DB: 1 GB / 1 CPU / 256 PIDs; Caddy: 256 MB / 1 CPU / 128 PIDs; migration: 512 MB / 1 CPU / 128 PIDs) and rotates container logs at 3 × 10 MB. Caddy bounds header reads to 10 seconds and body/write/idle time to 120 seconds. Tune these values after load testing.

## 9. Building on another machine

The default is to build on the server itself (`--build`). To build elsewhere (e.g. on an arm64 Mac for an x86_64 server) and ship the image through a registry:

```bash
docker buildx build --platform linux/amd64 -t registry.example.com/employee-portal:1.0.0 --push .
```

On the server set `image: registry.example.com/employee-portal:1.0.0` for the `app` service and remove `build: .`, then `docker compose -f docker-compose.prod.yml pull && up -d`.

## 10. Azure instead of a VM (later option)

The app is 12-factor: one stateless container configured entirely by environment variables, plus PostgreSQL. On Azure Container Apps or App Service for Containers: use the same image, Azure Database for PostgreSQL – Flexible Server for the database, secrets in Key Vault referenced as environment variables, the platform's ingress for TLS (no Caddy), and run `node dist/migrate.mjs` as a job before each revision (or keep the default start command, which migrates on start). The `KeyProvider` interface in `src/server/crypto` is where a Key Vault–backed key would plug in.

## Go-live checklist

Local security verification on 2026-10-09: 149 tests passed against disposable PostgreSQL 18; typecheck, lint, Next production build and CLI build passed. The standalone server started with the restricted runtime DB role; anonymous access checks passed, and the role could append audit entries but could not delete them or disable their trigger. Local tests do not validate the real Entra tenant or VPN server.

Dependency scan still needs follow-up: full `npm audit` reports 9 High package entries from the `braces` development-tool chain and 4 Moderate entries from the old `esbuild`/`drizzle-kit` chain; these are inherited findings, not 13 independent flaws. `--omit=dev` reports the latter 4. The inspected standalone output excludes `drizzle-kit`, `@esbuild-kit` and `esbuild`; the built CLI bundles its migration code without using drizzle-kit. Do not apply the audit tool's suggested major downgrades blindly. Recheck advisories and the final container before rollout.

- [ ] `https://<PORTAL_HOST>` has a valid certificate; `http://` redirects to `https://`
- [ ] `AUTH_MOCK` is absent from `.env`; exactly one `ALLOWED_UPN_DOMAINS` entry is set
- [ ] Entra: *Assignment required = Yes*, groups assigned to **Portal User** / **Portal Admin**, production redirect URI added
- [ ] Entra ID-token `upn` optional claim is configured; real SSO login tested for user, admin, unassigned and wrong-tenant accounts
- [ ] Conditional Access policy requires MFA (phishing-resistant authentication for admins); validate the actual tenant policy
- [ ] Offboarding drill completed: remove Entra access, revoke portal sessions, revoke credentials on each VPN server, deactivate portal configs
- [ ] Login reuse procedure reviewed; pending configs and manual aliases checked before reassignment
- [ ] Supported Pritunl exports pass dry-run and import/download round-trip on staging
- [ ] Dependency and container-image vulnerability scans refreshed; applicable upstream security updates installed
- [ ] Ingress timeouts, container memory/CPU/PID limits and log rotation configured and load-tested for this server
- [ ] Client secret expiry date is in the calendar
- [ ] `CONFIG_ENC_KEYS` (and the rest of `.env`) stored in the vault, separately from backups
- [ ] Backup cron runs; one restore tested
- [ ] Off-server copy of backups configured
- [ ] SSH limited to admin networks; only 80/443 open to the internet
- [ ] "How to connect" texts reviewed (they are drafts)
