# CLAUDE.md

`src/config/env.ts` is the **single parse point** for every server env var — no `process.env` read
belongs anywhere else. App-wide context: `apps/server/CLAUDE.md`.

## Core vars

`PORT`, `MONGO_URL`, `MONGO_DB`, `CORS_ORIGINS` (comma list), `TRM_PERSISTENCE` (`0` = in-memory, no
auth/lobby), `TRM_DEV_GAME` (`1` = seed a demo game on boot), `GIT_COMMIT` (baked by CI).

`JWT_SECRET` signs every server-minted credential and is **required**: a missing, <32-char, or
known-dev-default value **fails the boot** rather than signing with a public literal.

`COOKIE_SECURE` — the Secure attribute on `trm_refresh` + the OAuth/Apple nonce cookies; defaults to
**on**, set to `0` only to opt out for an http-only deployment.

`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` — all optional; an unset DSN turns
error reporting and tracing off entirely (`../observability/CLAUDE.md`).

## Everything else belongs to an area

| Vars                             | Doc                      |
| -------------------------------- | ------------------------ |
| Auth/OAuth providers, token TTLs | `../auth/CLAUDE.md`      |
| Bots + turn timer                | `../ws/CLAUDE.md`        |
| Push/APNs/FCM                    | `../push/CLAUDE.md`      |
| `DASHBOARD_OWNER_IDS` + purge    | `../dashboard/CLAUDE.md` |
| Mobile version gate + deep links | `../health/CLAUDE.md`    |
| Support form + ratings webhook   | `../support/CLAUDE.md`   |

Adding a var means adding it here **and** documenting it in the owning area's doc.
