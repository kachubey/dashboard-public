# Original brief and decisions

The project was built from the brief below (received 2026-10-07, built 2026-10-08 in four reviewed phases). The brief is kept verbatim; the decision log after it records where and why the implementation deviates or goes further.

## Decision log

| Topic | Brief | Implemented | Why |
|---|---|---|---|
| Auth library | Auth.js (NextAuth) | Better Auth 1.7 | Auth.js v5 never left beta (5.0.0-beta.32) and is in security-only maintenance under the Better Auth team; a fail-open advisory hit v5 betas in July 2026. Better Auth has a stable 1.x line with the same capabilities (DB sessions, Entra provider, PKCE) |
| ORM | Prisma or Drizzle | Drizzle | SQL-first schema, plain SQL migrations (append-only audit trigger, data backfills), no codegen step; Prisma was mid-way to a new major |
| Dev environment | `docker compose up` + `npm run dev` | Containers on the active Docker context, Node on the development machine | Works with local Docker or a remote development host |
| Next.js caching | — | Cache Components off | Every page is per-user and some carry secrets; nonce CSP needs dynamic rendering anyway |
| Language | switcher in header | No locale in URLs; cookie + user profile + Accept-Language; Entra sign-in page gets `ui_locales` | Internal portal: links are shared between people reading different languages; no SEO |
| Unmatched files | "go to quarantine" | Valid files for people who haven't signed in yet are imported as *waiting for owner*; only invalid files go to quarantine (kept encrypted 30 days, accept-with-fix or delete) | Pre-importing for new hires is the point; the admin UI lists waiting keys and flags old ones as likely typos |
| Audit actions | 7 actions | + sign_out, config_deactivate/reactivate/rollback, alias_update, quarantine_resolve/delete, audit_export, sessions_revoke | Every admin change that affects who gets which secret is audited; exporting the audit log is itself audited |
| Internal e-mail | — | `<oid>@oid.invalid` | UPNs get reused; using the UPN as the unique e-mail would block a new employee with a former colleague's address |
| Ownership | owner key → user via `owner_aliases` | Plus *claim*: a config belongs to the person its key first resolved to; serving needs alias and claim to match | Independent security review: otherwise an admin could re-point a colleague's key at themselves and download the colleague's configs |
| Admin powers | upload, replace, deactivate, delete; no content download | Plus: no assigning keys or quarantined files to oneself; quarantined file owner locked when readable from the name; "sign out everywhere" | Same review |
| Config validation | `client`/`remote`, `[Interface]`/`[Peer]`, valid `vless://` | Plus: refuse command-running directives (OpenVPN `up`/`down`/`script-security`/`plugin`…, WireGuard `PreUp`/`PostUp`…) | A replaced config must not become code execution on employee machines |
| Pritunl file names | `<ownerKey>__pritunl__<label>` | Pritunl downloads imported unrenamed: owner = header `user` (short UPN), label = header `server`; the convention still works; a renamed profile whose header names someone else → quarantine | Requester confirmed Pritunl user names are the short UPN (2026-10-09); the header is unambiguous where `<org>_<user>_<server>` isn't (`_` in names); the mismatch check stops a profile being handed to the wrong person |
| Production DB access | — | One-shot `migrate` job as owner; app runs as `portal_app` (no DDL, audit log INSERT/SELECT only) | Makes the append-only audit log real |
| OAuth tokens | — | Not stored; ID-token sign-in disabled; no refresh tokens requested | Nothing uses them after sign-in; a stored ID token could be replayed from a DB copy |
| Graph `employeeId` | "verify the permission" | Delegated `User.Read` is enough (`GET /me?$select=employeeId`) — per Microsoft Learn | — |

Deployment-specific settings live in private environment files: `SUPPORT_URL`, `APP_TIME_ZONE`, and one UPN domain enforced with `ALLOWED_UPN_DOMAINS`. The source and examples use neutral defaults.

## Brief (verbatim)

# Employee Portal — build brief for Claude Code

## Context and goal

I'm an IT admin. Today every VPN config is created by hand and sent to each employee individually. I want to remove the delivery part of that work: employees sign in with their corporate Microsoft account and download only their own VPN configs. Config creation stays manual for now (I export files and drop them into a folder), but the architecture must make it easy to plug in automated config generation later (Pritunl API, 3x-ui/Xray API).

The VPN tab is the first module of a classic employee portal. Later there will be Docs, Instructions and other sections, so build a clean, extensible shell, not a one-page app.

There is no production server yet. We're building and running locally first. I will NOT give you access to the Entra tenant: you write step-by-step instructions and I configure Entra by hand.

**Before writing code:** read this whole brief, propose the architecture, folder structure, data model and phase plan, list any assumptions, and wait for my confirmation. Use current stable versions of all libraries and verify APIs against current docs instead of relying on memory.

## Tech stack (adjust only with a stated reason)

- Next.js (App Router) + TypeScript, strict mode
- Auth.js (NextAuth) with the Microsoft Entra ID provider — OIDC authorization code flow with PKCE, confidential client, server-side session in an httpOnly, Secure, SameSite=Lax cookie. No tokens in localStorage.
- PostgreSQL + Prisma or Drizzle (your choice, justify it). Docker Compose for local Postgres.
- Tailwind CSS + shadcn/ui, dark theme by default (light theme toggle is optional)
- next-intl for i18n: English (default) and Russian, language switcher in the header, all UI strings in message files
- Zod for validation of all inputs
- Deployment target: Docker Compose on my own Linux server (app + Postgres + Caddy reverse proxy with automatic TLS). Keep the app 12-factor so Azure Container Apps / App Service remains an option.

## Authentication and authorization

- Single-tenant Entra app registration.
- Access gating: "Assignment required = Yes" on the Enterprise Application; I assign a security group.
- Roles via **App Roles** (not group claims, to avoid group overage): `Portal.User` and `Portal.Admin`. Read the `roles` claim from the ID token. No role → access denied page.
- Identify users by the immutable Entra **Object ID (oid)**, not by UPN. On every sign-in, upsert the user record: oid, UPN, display name, `shortUpn` (lowercased part of the UPN before `@`), last sign-in time.
- Optional, behind a feature flag: read `employeeId` from Microsoft Graph `/me` at sign-in to support mapping by employee code. Verify which delegated permission is actually required and document it.
- Header shows the user's display name (fall back to UPN) and a sign-out button.
- **Dev mode:** a mock auth provider that lets me pick from seeded fake users (one admin, several regular users) without Entra. It must be enabled only when `NODE_ENV=development` AND `AUTH_MOCK=true`, and the app must refuse to start in production if `AUTH_MOCK` is set.

## Core problem: mapping config files to employees

Design this carefully; it is the heart of the project.

**Owner key.** Each config is owned by an "owner key", which is the `shortUpn` by default. Support an alternative key type `employeeCode`. Keep a table `owner_aliases` (key type + key value → user oid) so a renamed UPN or employee code can be re-linked without re-importing files. Configs may be imported before the user has ever signed in; they are linked to the user on first sign-in when the owner key matches.

**File naming convention for manual drops** (case-insensitive):

```
<ownerKey>__<type>__<label>.<ext>

alice__pritunl__main.ovpn
alice__vless__nl-1.txt        (single vless:// link inside)
alice__vless__de-1.txt
alice__wg__office-a.conf
E1042__pritunl__main.ovpn      (employee code as owner key, if enabled)
```

- `type` ∈ `pritunl` (.ovpn), `vless` (.txt with one `vless://` URI), `wg` (.conf). Make the type list a registry so new types are a small change.
- `label` distinguishes several configs of the same type (servers/locations); shown to the user.
- If Pritunl exports a `.tar` with a `.ovpn` inside, the importer extracts it.

**Bulk manifest import** as a second method, mainly for VLESS links copied from 3x-ui: a CSV with columns `ownerKey,type,label,content_or_filename`.

**Import pipeline** (shared by CLI and admin UI):

1. Parse and validate (naming, extension, content sanity: `.ovpn` has `client`/`remote`, `.conf` has `[Interface]`/`[Peer]`, vless is a valid `vless://` URI).
2. Resolve owner key → user. Results: matched, pending (valid key, user hasn't signed in yet), invalid.
3. **Dry-run preview first**: a table showing each file, parsed owner/type/label, match status and whether it creates or replaces a config. Commit only after confirmation.
4. Same owner + type + label → new version; previous version is kept inactive (history, rollback). Only the active version is downloadable.
5. Unmatched/invalid files go to a quarantine list visible to admins.

Entry points: a CLI (`npm run import -- ./inbox [--dry-run]`) and drag-and-drop multi-file upload on the admin page.

**Future automation hook:** define a `ConfigProvider` interface (e.g. `listForUser`, `issueForUser`, `revokeForUser`). The only implementation now is `ManualImportProvider`. Leave stub classes with TODO comments for `PritunlApiProvider` and `XuiApiProvider` (3x-ui). Don't implement them.

## Security requirements

- Config contents contain private keys: **encrypt at rest** in the database with AES-256-GCM, key from an environment variable (design so it can move to a KMS/Key Vault later; support key rotation via a key id stored per row).
- Every download/reveal endpoint checks on the server that the config belongs to the session user and is active. Never trust client-supplied user ids.
- Admins can upload, replace, deactivate and delete configs and see metadata, but by default **cannot download other users' config contents** through the UI.
- Responses with config content: `Cache-Control: no-store`, correct `Content-Disposition` filename, no content in logs or error messages.
- Security headers (strict CSP, HSTS in prod, X-Content-Type-Options, frame-ancestors none), CSRF protection on mutations, rate limiting on download and import endpoints, upload size/type limits.
- Secrets only via environment variables; provide `.env.example` with comments.

## Audit log

Append-only table: timestamp, actor oid/UPN, action (`sign_in`, `config_download`, `config_reveal`, `import_commit`, `config_replace`, `config_delete`, `access_denied`), target config id, IP, user agent. Admin page to filter by user, action and date, with CSV export. Also show per config "last downloaded at" so I can see who hasn't picked up their config.

## UI

**Shell:** sidebar navigation with modules: Home, VPN (active), Documents and Instructions (visible but disabled, "Coming soon"), Admin (only for `Portal.Admin`). Make modules a simple registry so adding a section is easy. Responsive, works on mobile (employees will open it on phones to set up VPN clients).

**Home:** greeting with the user's name and a card linking to VPN.

**VPN page**, grouped by type, in this order:

1. **Pritunl (OpenVPN)** — primary. Card with label, last updated date, Download button.
2. **Xray / VLESS** — primary. One card per link: label, "Show link" (masked by default, reveal is audited), Copy button, QR code (rendered client-side, only after reveal), Download as .txt.
3. **WireGuard** — legacy. Collapsed section with a "Legacy, will be retired" badge; same download cards.

Empty state when the user has no configs: short text with a support contact (configurable). Each section has a short "How to connect" accordion with per-OS steps (Windows, macOS, iOS, Android) and client download links. Store this instruction text in editable Markdown files per language, not hardcoded in components, so I can edit it without touching code. Write placeholder content I'll review.

**Admin page:** tabs for Import (upload + dry-run preview), Configs (search by user, version history, deactivate/delete), Users (signed-in users, their aliases, edit alias), Quarantine, Audit log.

## Deliverables

- Working app runnable locally with `docker compose up` (Postgres) + `npm run dev`, mock auth and seed data with sample configs of every type
- Database migrations and a seed script
- CLI importer with dry-run
- Tests for: file name parser, content validators, owner resolution, authorization (user A can't get user B's config), encryption round-trip
- `README.md`: architecture overview, local setup, env vars, import workflow, how to add a new config type and a new portal module
- `docs/ENTRA_SETUP.md`: click-by-click guide for me to create the app registration manually: redirect URIs for local and prod, client secret (with expiry reminder) or certificate, API permissions with admin consent, the two App Roles, Assignment required, assigning groups to roles, which values go into `.env`
- `docs/DEPLOY.md`: production Docker Compose with Caddy, backups for Postgres and the encryption key, update procedure

## Phases (stop for my review after each)

1. Shell, i18n, dark theme, mock auth, Entra auth, role gating, Home page
2. Data model, encryption, import pipeline + CLI, VPN page with downloads
3. Admin UI, quarantine, audit log
4. Hardening, tests, docs, production Docker setup
