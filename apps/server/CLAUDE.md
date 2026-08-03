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

| Area                                                         | Doc                           |
| ------------------------------------------------------------ | ----------------------------- |
| Realtime hub loop, egress guard, bots, turn timer/takeover   | `src/ws/CLAUDE.md`            |
| Game session (prepare/commit/restore), queue, board resolver | `src/game/CLAUDE.md`          |
| Event-sourced store, recovery, digests, version pins         | `src/persistence/CLAUDE.md`   |
| History + replay gating, visibility                          | `src/history/CLAUDE.md`       |
| Tokens, guests, OAuth, Apple, mobile transport               | `src/auth/CLAUDE.md`          |
| Account-deletion cascade                                     | `src/account/CLAUDE.md`       |
| Rooms, seat CAS, match start                                 | `src/lobby/CLAUDE.md`         |
| Custom maps, share codes, `mapContents`                      | `src/maps/CLAUDE.md`          |
| Train-card skin availability (cosmetics)                     | `src/skins/CLAUDE.md`         |
| Blocks + reports (UGC compliance)                            | `src/moderation/CLAUDE.md`    |
| Push + iOS Live Activities                                   | `src/push/CLAUDE.md`          |
| Maintainer dashboard, permissions, audit, purge              | `src/dashboard/CLAUDE.md`     |
| Mobile version gate + deep-link well-knowns                  | `src/health/CLAUDE.md`        |
| Metrics, Sentry, `instrument.mjs`, `ErrorReporter`           | `src/observability/CLAUDE.md` |
| Server OTA: hot code updates, the deps fence, rollback       | `src/selfupdate/CLAUDE.md`    |
| Env vars (the single parse point)                            | `src/config/CLAUDE.md`        |
| Engine⇄wire codec seam                                       | `packages/codec/CLAUDE.md`    |

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
`/api/openapi.json`). Metrics at `/metrics`; the process is started as
`node --import ./instrument.mjs src/main.ts` and that ordering is load-bearing —
`src/observability/CLAUDE.md`.

## Env vars

**Every** var is parsed in one place, `src/config/env.ts`; `JWT_SECRET` is required and fails the
boot if weak. The core set and the per-area index are in `src/config/CLAUDE.md`.
