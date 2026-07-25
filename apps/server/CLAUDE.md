# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`apps/server` is the **authoritative** NestJS backend: a WebSocket gateway for realtime play, a REST
control plane (auth/lobby/history), Mongo event-sourced persistence, dynamic OpenAPI, and the bot
driver. It is the sole source of truth and never trusts the client.

```bash
yarn workspace @trm/server dev          # node --watch via @swc-node/register (NOT tsx)
yarn workspace @trm/server test         # vitest (mongodb-memory-server, no real Mongo needed)
yarn workspace @trm/server test --run bots.e2e   # one spec by file substring
```

## Where the per-area docs live

Read the one for the area you're touching (Claude Code loads them on demand). Each carries its own
env vars.

| Area                                                         | Doc                         |
| ------------------------------------------------------------ | --------------------------- |
| Realtime hub loop, egress guard, bots, turn timer/takeover   | `src/ws/CLAUDE.md`          |
| Game session (prepare/commit/restore), queue, board resolver | `src/game/CLAUDE.md`        |
| Event-sourced store, recovery, digests, version pins         | `src/persistence/CLAUDE.md` |
| History + replay gating, visibility                          | `src/history/CLAUDE.md`     |
| Tokens, guests, OAuth, Apple, mobile transport               | `src/auth/CLAUDE.md`        |
| Account-deletion cascade                                     | `src/account/CLAUDE.md`     |
| Rooms, seat CAS, match start                                 | `src/lobby/CLAUDE.md`       |
| Custom maps, share codes, `mapContents`                      | `src/maps/CLAUDE.md`        |
| Blocks + reports (UGC compliance)                            | `src/moderation/CLAUDE.md`  |
| Push + iOS Live Activities                                   | `src/push/CLAUDE.md`        |
| Maintainer dashboard, permissions, audit, purge              | `src/dashboard/CLAUDE.md`   |
| Mobile version gate + deep-link well-knowns                  | `src/health/CLAUDE.md`      |
| Engine⇄wire codec seam                                       | `packages/codec/CLAUDE.md`  |

## swc, not tsx (the #1 gotcha)

`dev`/`start` run through `@swc-node/register/esm-register` and tests through `unplugin-swc`. NestJS
DI resolves constructor dependencies from emitted **decorator metadata**, which esbuild/tsx does not
produce — switch the runtime to tsx/esbuild and DI silently fails at boot. Keep swc.

## The two planes

**Realtime** — `src/ws/hub.ts` decodes a `ClientEnvelope`, serializes it through the **per-game
command queue** (single writer), drops replays by `client_seq`, maps it to an engine action
(`@trm/codec`), **persists write-ahead** (durable before visible), then commits on the engine and fans
out a **per-recipient redacted snapshot**. Raw `GameState` must never be serialized to a client — all
egress is the `redactFor` projection, backed by a runtime guard and the
`trm_security_leak_blocked_total` metric. Full loop: `src/ws/CLAUDE.md`.

**Control** — REST under `api/v1`. Validation + OpenAPI schemas come from **one zod source** via
`nestjs-zod` (ADR A3), so the doc is generated from the live app.

## App wiring (`src/main.ts`)

Wires helmet (CSP off so Scalar's CDN loads — tighten in prod), cookie-parser, the CORS allowlist,
attaches the ws server, and builds the OpenAPI doc from the live app (Scalar at `/docs`, JSON at
`/api/openapi.json`). Metrics at `/metrics` (prom-client, `src/observability/`).

## Observability (`src/observability/`)

Two signals, wired at the same call sites: **metrics** say how often, **error reports** say what.

- `metrics.service.ts` / `hooks.ts` — prom-client at `/metrics`.
- `sentry.ts` + `instrument.mjs` — Sentry, opt-in via `SENTRY_DSN` (unset ⇒ `Sentry.init` is never
  called and the whole SDK is inert). `instrument.mjs` is the process's **first `--import`**
  (`node --import ./instrument.mjs src/main.ts`): under ESM the module graph is linked before any
  of it evaluates, so an import inside `main.ts` would lose the race against `http`/`mongodb` and
  produce no spans. It is `.mjs` and not `.ts` because `@swc-node/register`'s ESM resolver resolves
  a relative specifier against `dirname(parentURL)` — for a `--import` the parentURL is the cwd
  **directory**, so `--import ./src/instrument.ts` lands one level too high and fails to resolve.
  Loading a plain `.mjs` first goes through Node's own resolver, and it registers swc for the rest
  of the process. **Do not "simplify" this back into `main.ts`.**
- `error-reporter.ts` — the framework-free `ErrorReporter` port (same shape as `MetricsHooks`,
  `NOOP_REPORTER` by default so tests stay silent), wired into `GameHub` for the four
  "should stay 0" events: the `receive` catch-all, unrecoverable games, bot-driver stalls, and
  `leak_blocked` — which reports at **fatal** with the two seat ids and nothing else, because
  attaching the snapshot would commit the very leak the guard just stopped.

Nothing reaches Sentry unscrubbed: `beforeSend`/`beforeSendTransaction`/`beforeBreadcrumb` all run
`@trm/shared`'s `scrubTelemetryEvent`, the single denylist shared with web/admin/mobile.

## Env vars (core)

`src/config/env.ts` is the single parse point for all of them.

`PORT`, `MONGO_URL`, `MONGO_DB`, `CORS_ORIGINS` (comma list), `TRM_PERSISTENCE` (`0` = in-memory, no
auth/lobby), `TRM_DEV_GAME` (`1` = seed a demo game on boot), `GIT_COMMIT` (baked by CI).

`JWT_SECRET` signs every server-minted credential and is **required**: a missing, <32-char, or
known-dev-default value **fails the boot** rather than signing with a public literal.

`COOKIE_SECURE` — the Secure attribute on `trm_refresh` + the OAuth/Apple nonce cookies; defaults to
**on**, set to `0` only to opt out for an http-only deployment.

`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` — all optional; an unset DSN turns
error reporting and tracing off entirely (see Observability above).

Everything else belongs to an area: auth/OAuth/token TTLs → `src/auth/CLAUDE.md`; bots + turn timer →
`src/ws/CLAUDE.md`; push/APNs/FCM → `src/push/CLAUDE.md`; `DASHBOARD_OWNER_IDS` + purge →
`src/dashboard/CLAUDE.md`; mobile version gate + deep links → `src/health/CLAUDE.md`.
