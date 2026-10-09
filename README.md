# Employee Portal

## Quick start: demo without Entra or DNS

Requirements: **Docker with Compose** and **OpenSSL** on macOS or Linux. After cloning this repository, run these commands from the project directory:

```bash
./deploy/demo.sh init
./deploy/demo.sh start
```

Open **https://127.0.0.1:8443**. Caddy uses a local CA, so your browser will show a certificate warning. Select **Alex Admin** to explore administration, or **Alice Anderson / Bob Brown** for an employee dashboard. **John Smith** has an empty dashboard; **No Role** demonstrates access denial. No password or Microsoft account is needed. The VPN profiles are non-working samples.

```bash
./deploy/demo.sh stop     # stop while keeping data
./deploy/demo.sh start    # start again, or rebuild after a code update
./deploy/demo.sh status   # show container status
./deploy/demo.sh logs     # follow application logs; Ctrl+C stops following
```

The script generates `.env.demo` with independent secrets, creates the `portal-demo` Compose project and seeds its separate database. Repeating `init` preserves settings; repeating `start` preserves data. `./deploy/demo.sh seed` restores the standard samples, potentially replacing edited samples without deleting other imports. The demo uses the development server, so the first page load may take longer.

**Optional remote host:** run the commands on that host, using `./deploy/demo.sh init <private-ip>` on the first run. Replace `<private-ip>` with the host's private IPv4 address, then open `https://<private-ip>:8443`. By default, the demo binds only to loopback; choosing a private IP makes it accessible to devices that can reach that address. Use a Docker context connected to the host where you intend to run the demo.

Do not upload real VPN credentials: anyone who can reach the demo can sign in as an administrator. The normal `docker-compose.prod.yml` deployment remains **Entra-only**, with separate settings and volumes. See [Configure your organization](#configure-your-organization) for domain settings and [production deployment](docs/DEPLOY.md) for the server setup.

---

Self-service portal for employees: sign in with the corporate Microsoft account and get your own work tools. The first module is **VPN** — each employee downloads only their own VPN configs. Documents and Instructions modules are planned.

> Status: **all four phases done** — portal shell, Entra + mock sign-in, role gating, encrypted VPN configs, import pipeline + CLI, VPN page with downloads, admin UI (import, configs, users & owner keys, quarantine, audit log + CSV), production Docker setup with Caddy. Before go-live: configure Entra ([docs/ENTRA_SETUP.md](docs/ENTRA_SETUP.md)), review the "How to connect" drafts in `content/instructions/`, follow [docs/DEPLOY.md](docs/DEPLOY.md).

## Documents

| Document | For |
|---|---|
| [docs/BRIEF.md](docs/BRIEF.md) | The original brief (verbatim) and the decision log — where and why the build deviates |
| [docs/ENTRA_SETUP.md](docs/ENTRA_SETUP.md) | Registering the app in Entra ID: redirect URIs, secret, `upn` claim, permissions, the two App Roles, assignment |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Production: server, Docker Compose + Caddy, secrets, backups and restore, imports, updates, key rotation, go-live checklist |
| `.env.example` / `.env.production.example` | Every environment variable, explained |

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict | Server-rendered portal, Server Actions for mutations |
| Auth | Better Auth 1.7 + Microsoft Entra ID provider | Stable 1.x line, database sessions, OIDC code flow with PKCE, ID-token `oid` as account key. Auth.js v5 never left beta and is in security-only maintenance under the Better Auth team |
| Database | PostgreSQL 18 + Drizzle ORM | SQL-first schema and plain SQL migrations (append-only audit trigger lives in a migration), no codegen step |
| UI | Tailwind CSS 4 + shadcn/ui (Base UI), dark by default | |
| i18n | next-intl 4, English + Russian | |
| Validation | Zod 4 | Env, inputs |

## Architecture

- **`src/proxy.ts`** — per-request CSP nonce, security headers, optimistic redirect to `/signin` when there is no session cookie.
- **`src/server/auth/`** — Better Auth config (`index.ts`), roles (`roles.ts`), the Data Access Layer (`session.ts`: `requireUser`, `requireAdmin`), Server Actions (`actions.ts`), dev-only mock sign-in plugin.
- **Authorization** happens on the server for every page, action and route via `session.ts`; nothing trusts client-supplied ids. Users without `Portal.User` / `Portal.Admin` never get a session (audited as `access_denied`).
- **`src/server/env.ts`** — Zod-validated configuration; `src/instrumentation.ts` stops the server on invalid config, including `AUTH_MOCK` set in production.
- **`src/server/audit.ts`** + `audit_log` table — append-only (a database trigger rejects UPDATE/DELETE/TRUNCATE).
- **`src/modules/registry.ts`** — portal sections; the sidebar is built from it.
- **`src/server/vpn/`** — the VPN module: config type registry (`types.ts`), file-name parser (`filename.ts`), owner resolution and aliases (`owners.ts`), the import pipeline (`import/`), user-scoped reads (`repository.ts`), `ConfigProvider` interface with `ManualImportProvider` and stubs for Pritunl / 3x-ui APIs (`providers.ts`), "How to connect" loader (`instructions.ts`).
- **`src/server/crypto/`** — AES-256-GCM encryption at rest behind a `KeyProvider` interface (environment keys today, KMS/Key Vault later). Each row stores its key id; the AAD binds a ciphertext to its row.
- **`src/i18n/`** + `messages/{en,ru}.json` — locale from explicit choice (cookie, restored from the user profile at sign-in) → browser `Accept-Language` → English. No locale in URLs, so shared links open in each reader's language.

Sessions are database-backed: the browser holds only a signed, httpOnly, SameSite=Lax session cookie (Secure in production). Sessions last `SESSION_MAX_AGE_HOURS` (default 8) and are never extended, so roles are re-read from Entra at least that often. Unused Better Auth endpoints (profile edits, token export, account linking, password flows, client-side session read) are disabled.

## Local development

Requirements: **Node.js 24 LTS**, npm and Docker with Compose. Run the application locally and PostgreSQL through your active Docker context.

```bash
cp .env.example .env.local
# Set BETTER_AUTH_SECRET: openssl rand -base64 48
# Set CONFIG_ENC_KEYS / CONFIG_ENC_ACTIVE_KEY_ID: npm run keys:generate
# Keep AUTH_MOCK=true to work without Entra.
# DATABASE_URL defaults to PostgreSQL on localhost:5432.

npm ci
docker compose --env-file .env.local -f docker-compose.yml up -d --wait
npm run db:migrate
npm run db:seed      # sample users and VPN configs
npm run dev         # http://localhost:3000, bound to loopback
```

If Docker runs on a remote host, select it with `export DOCKER_CONTEXT=<context-name>` and set `DATABASE_URL` in `.env.local` to the database address reachable from your development machine. The npm shortcuts and smoke tests respect this Docker context. Keep the development database port accessible only from your development machine.

The example database password is public and intended only for disposable development data. To use a different password, set `DEV_POSTGRES_PASSWORD` and update `DATABASE_URL` in `.env.local` and `TEST_DATABASE_URL` in `.env.test` to match. An existing PostgreSQL volume retains its original password; changing an environment variable does not rotate it.

Stop the app with `Ctrl+C` and the database with `docker compose --env-file .env.local -f docker-compose.yml stop`. Database data remains in its Docker volume.

Microsoft sign-in: follow [docs/ENTRA_SETUP.md](docs/ENTRA_SETUP.md), then fill the `ENTRA_*` variables. Mock and Entra sign-in can be enabled together in development.

## How config ownership works

Configs are owned by an **owner key** — by default the part of the UPN before `@` (`alice`), optionally an employee code (`E1042`, with `FEATURE_EMPLOYEE_ID=true`). The `owner_aliases` table maps keys to people (by Entra object ID). On every sign-in the portal adds the person's own keys, so configs imported **before** someone's first sign-in appear as soon as they sign in. Previously claimed configs remain attached to their owner after a rename. New imports under stale automatic aliases or known collisions go to quarantine; admins can explicitly resolve the owner key. Directory changes become known at the next sign-in, not immediately. An alias that already points at someone else is never taken over automatically (a reused UPN must not inherit a former employee's configs); the conflict is written to the audit log.

## Importing configs

Drop files into a folder (keep it **outside synced folders** — the files contain private keys).

**Pritunl downloads go in as they are** — no renaming. Pritunl names the archive after the user (`alice.tar`) and each profile inside `<organization>_<user>_<server>.ovpn`; every profile also starts with a JSON header in `#` comments. The importer reads the owner key from the header's `user` (the short UPN; a full UPN is cut at `@`) and the label from `server` (`Office Main_VPN` → `office-main-vpn`). One config per server; the archive's own name doesn't matter (`alice (1).tar` works). A `.ovpn` taken out of the archive works the same way. A `.tar`/`.ovpn` without `__` in its name and without a Pritunl header goes to quarantine.

Everything else is named `<ownerKey>__<type>__<label>.<ext>`:

```
alice.tar                     # straight from Pritunl → alice / pritunl / <server name>
alice__vless__nl-1.txt        # one vless:// link
alice__wg__office-a.conf
alice__pritunl__main.ovpn     # a renamed Pritunl profile still works
E1042__pritunl__main.ovpn      # employee code as owner key
```

A renamed Pritunl profile whose header names a different user than the owner key in the file name is quarantined (`pritunl_owner_mismatch`): the profile authenticates as the user in its header, so it must not be handed to someone else.

A `.csv` manifest in the same folder imports many rows at once, typically VLESS links copied from 3x-ui:

```csv
ownerKey,type,label,content_or_filename
alice,vless,fi-1,vless://…
bob,wg,lab,bob-lab.conf
```

```bash
npm run import -- ./inbox --dry-run   # preview: owner, match, create/replace/unchanged/quarantine
npm run import -- ./inbox             # preview, then asks before writing
npm run import -- ./inbox --yes --delete-imported
```

- **matched** — the owner has signed in; **pending** — valid, waits for the owner's first sign-in; **invalid** — goes to quarantine.
- Same owner + type + label as an existing config → new version; the previous one is kept inactive (history/rollback). An identical file is reported as **unchanged**.
- **Quarantine** keeps rejected files (encrypted, 30 days) with the reason, so nothing is silently lost; admins fix or delete them in the admin UI (phase 3). The CLI prints the reason for every rejected file.

## Admin (`Portal.Admin`)

| Tab | What it does |
|---|---|
| Overview | Active configs, configs waiting for an owner, configs nobody downloaded yet, quarantine size |
| Import | Drag-and-drop upload → preview (same plan as the CLI) → import. The browser sends the files twice; the commit is refused if they differ from the preview (fingerprint), nothing is stored in between |
| Configs | Search by owner / user / label, filter by type and status (incl. *waiting for owner* and *not picked up*); per config: owner, last download, version history, deactivate / reactivate, roll back, delete (crypto-shred: all encrypted versions are destroyed, the row stays as a tombstone for the audit log) |
| Users | Signed-in users with roles, last sign-in, owner keys; add or remove a key; moving a key that belongs to someone else needs an explicit tick. *Waiting for owner* lists unlinked keys (older than 14 days are flagged as likely typos) with a "link to user" field |
| Quarantine | Rejected files with the reason; accept under a corrected owner/type/label (goes through the normal import pipeline) or delete |
| Audit log | Filter by user, action and dates; CSV export (formula-injection safe, UTF-8 with BOM for Excel); the export itself is audited |

Admins never see other people's config contents: no admin page or endpoint returns them, and the regular download route serves only the signed-in user's own configs. Every admin change is a Server Action that re-checks the role and writes an audit entry.

## Adding a config type

1. Add a `ConfigTypeDef` to `src/server/vpn/types.ts` (extensions, download MIME type, order, `legacy`, `revealable`, `validate()`).
2. Add `vpn.types.<id>.title` / `.description` to `messages/en.json` and `messages/ru.json`.
3. Add `content/instructions/en/<id>.md` and `content/instructions/ru/<id>.md`.
4. Add the id to the `types` of the provider that serves it (`src/server/vpn/providers.ts`) and to the `typeKey` union on the VPN page.

## Encryption keys

`CONFIG_ENC_KEYS` holds one or more `id:base64` AES-256 keys; `CONFIG_ENC_ACTIVE_KEY_ID` picks the one used for new data. **Back the keys up separately from database backups** — without them the configs can't be decrypted. Rotation: `npm run keys:generate` → append the new key and make it active → restart → `npm run keys:rotate` → remove the old key once it reports nothing left.

## Tests

`npm test` runs unit tests (file names, content validators, owner resolution, encryption, import inputs, env, i18n) and integration tests against a throwaway database from `.env.test` (copy `.env.test.example`; it is wiped on every run): user A can't list or download user B's configs, pending → linked on sign-in, versioning, alias re-linking, reused UPNs, ciphertext swapping, quarantine, append-only audit log. Integration tests are skipped when `TEST_DATABASE_URL` isn't set. To create the separate test database in the local development stack:

```bash
docker compose --env-file .env.local -f docker-compose.yml exec db createdb -U portal portal_test
cp .env.test.example .env.test
npm test
```

The `db:up` / `db:down` npm shortcuts use `.env.local` and your active Docker context. `db:down` removes containers but keeps the database volume.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on 127.0.0.1:3000 |
| `npm run build` | Production build (refuses to build while `AUTH_MOCK` is set) |
| `npm run typecheck` / `npm run lint` / `npm test` | TypeScript, ESLint, Vitest |
| `docker compose --env-file .env.local -f docker-compose.yml up -d --wait` / `stop` | Start / stop the local development database |
| `npm run db:generate` | Generate a SQL migration from `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed development data: mock users and sample configs of every type (refuses in production) |
| `npm run import -- <dir> [--dry-run] [--yes] [--delete-imported]` | Import config files |
| `npm run keys:generate` / `keys:rotate` | New encryption key / re-encrypt rows with the active key |
| `npm run build:cli` | Bundle the CLI scripts to `dist/*.mjs` (used by the Docker image) |
| `npm run e2e` | Browser smoke tests against the running dev server (resets dev data; see [e2e/README.md](e2e/README.md)) |

## Environment variables

All variables are documented in [.env.example](.env.example) (development) and [.env.production.example](.env.production.example) (production). Configuration is validated at startup; an invalid or incomplete configuration stops the server with a message naming the variable.

## Configure your organization

No source edits are needed for your domain or support service. Copy the appropriate environment example **only on a new installation**, then set these values in the private `.env` on the production server (or `.env.local` for development):

| Variable | Purpose | Example |
|---|---|---|
| `PORTAL_HOST` | Caddy host name; production Compose only | `portal.example.com` |
| `BETTER_AUTH_URL` | Public origin, matching the Entra redirect URI | `https://portal.example.com` |
| `ALLOWED_UPN_DOMAINS` | Exactly one employee UPN suffix in production; may differ from the portal host | `example.com` |
| `SUPPORT_URL` | Employee support link | `https://help.example.com` |
| `APP_TIME_ZONE` | IANA time zone for displayed dates | `UTC` |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | Your Entra app registration | See [Entra setup](docs/ENTRA_SETUP.md) |

Set the Entra Web redirect URI to `https://<portal-host>/api/auth/callback/microsoft`. Configure DNS, app roles, assignment and the `upn` claim before using real SSO. For public TLS, leave `CADDY_TLS` empty; a private rehearsal can use `tls internal`. Pritunl organization and server names are read from imported profiles and need no configuration in the source.

Keep `.env`, `.env.local`, `.env.test`, `.env.demo`, private notes in `.local/`, real profiles in `inbox/`, and backups out of Git. `.local/` is also excluded from Docker builds. On an existing installation, **preserve its encryption keys, database credentials and volumes** when updating source code. Do not replace the private environment file with the example. Apply environment-only changes with `docker compose -f docker-compose.prod.yml up -d --force-recreate --wait`; use `--build` when updating code.

Anonymizing current files does not remove earlier versions or author emails from Git history. For a public copy, review a clean export (`git archive HEAD`) and initialize a new repository from that export, using your GitHub-provided `noreply` commit email. Never publish a copy of the working directory containing private files or the old `.git` directory.

## Security overview

- **Sign-in:** Entra ID, OIDC authorization code flow with PKCE, confidential client, single tenant; minimal scopes (`openid profile email`, plus `User.Read` only with `FEATURE_EMPLOYEE_ID`). Sign-in with a bare ID token is disabled; OAuth tokens are discarded after sign-in, never stored. ID tokens are verified against tenant JWKS (RS256, issuer, audience, tenant, expiry and state-bound nonce). Users are identified by the immutable object ID; production requires exactly one `ALLOWED_UPN_DOMAINS` entry. The `upn` optional claim must be configured.
- **Authorization:** App Roles from the ID token, written to the user on every sign-in before the role gate; no role → no session (end-to-end tested through the real callback). Every page, Server Action and route handler re-checks the session on the server. Admins can end a user's sessions immediately.
- **Config ownership:** a config is served only if its owner key points at the session user **and** it was claimed by that user. Re-pointing or removing an owner key never hands existing configs to someone else; re-importing under a key that changed hands destroys the previous owner's versions. Admins can't assign owner keys or quarantined files to themselves, and can't change the owner of a quarantined file whose owner was readable from its name.
- **Sessions:** database-backed, httpOnly + Secure + SameSite=Lax cookie (`__Secure-` prefix in production), absolute lifetime (`SESSION_MAX_AGE_HOURS`, default 8 h).
- **Config contents:** AES-256-GCM at rest with per-row key id and AAD bound to config and version; downloads are `no-store`, rate-limited and audited; contents never appear in logs, errors or the audit log. Configs with command-running directives (OpenVPN `up`/`down`/`script-security`/`plugin`…, WireGuard `PreUp`/`PostUp`…) are rejected on import. OpenVPN accepts only reviewed canonical option names and supported inline key blocks; unknown options are quarantined.
- **Web:** strict nonce-based CSP for scripts, `frame-ancestors 'none'`, HSTS (production), `nosniff`, Referrer-Policy, Permissions-Policy; Origin checks on all state-changing endpoints (Server Actions have them built in); rate limits on sign-in, downloads, reveals and imports; upload size/type limits; CSV export protected against formula injection.
- **Audit log:** append-only — a database trigger, and in production the app's database role has only INSERT/SELECT on it and can't alter the schema. Admin changes and import audit entries commit in the same database transaction; an audit failure rolls back the change.
- **Mock sign-in:** only with `NODE_ENV=development` and `AUTH_MOCK=true`; the production build and server refuse to run with `AUTH_MOCK` set; the dev server listens on 127.0.0.1 only.
- **Container:** non-root, read-only filesystem, no Linux capabilities, database on an internal network; migrations run in a separate job with the owner credentials.

## Adding a portal module

1. Add an entry to `MODULES` in `src/modules/registry.ts` (`status: "coming_soon"` shows it disabled; `requiredRole` hides it from others).
2. Add the label under `modules.<id>` in `messages/en.json` and `messages/ru.json`.
3. Add an icon for the id in `src/components/shell/nav.tsx`.
4. Create `src/app/(portal)/<route>/page.tsx` and call `requireUser()` (or `requireAdmin()`) at the top.

## License

All rights reserved — see [LICENSE](LICENSE). The code is published for reference only.
