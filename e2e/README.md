# Browser smoke tests

Headless-Chromium walkthroughs of the real UI against the dev server (they complement the Vitest unit/integration tests in `tests/`). They print what they saw and take screenshots; a run without `console problems` and without exceptions is a pass.

| Script | Covers |
|---|---|
| `shell.mjs` | redirect to sign-in, mock sign-in, sidebar per role, language switch (persisted per user), sign-out, no-role → access denied, mobile layout |
| `vpn.mjs` | VPN page sections, download, VLESS reveal + QR + copy, legacy section, mobile |
| `admin.mjs` | admin overview, import preview/commit (files in `upload/`), configs filter/detail/rollback/deactivate/delete, link a waiting key, alias conflict, quarantine accept/delete, audit filter + CSV export, mobile |

Prerequisites: dev database up (`npm run db:up`), `npm run dev` running with `AUTH_MOCK=true`, Chromium for Playwright (`npx playwright install chromium`, once).

```bash
npm run e2e          # resets dev data, runs all three, screenshots in .e2e-shots/
```

Toast texts printed by `admin.mjs` can show `(none)` when a toast expired before it was read; check the audit log rather than the toast in that case.
