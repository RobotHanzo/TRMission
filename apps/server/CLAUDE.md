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

## swc, not tsx (the #1 gotcha)

`dev`/`start` run through `@swc-node/register/esm-register` and tests through `unplugin-swc`. NestJS
DI resolves constructor dependencies from emitted **decorator metadata**, which esbuild/tsx does not
produce — switch the runtime to tsx/esbuild and DI silently fails at boot. Keep swc.

## The realtime loop (the critical path)

`src/ws/hub.ts` (`GameHub`) is the dispatcher and the most important file. It operates on **bytes + a
Sink**, so the whole loop is drivable over real protobuf without a socket (that is how the e2e specs
work). Per inbound game command:

1. decode `ClientEnvelope`; route hello/ping/resync/chat vs. game commands.
2. serialize through the **per-game command queue** (`game/command-queue.ts`) — single writer.
3. idempotency: drop if `client_seq <= lastClientSeq` (monotonic per socket).
4. `commandToAction` (codec) → `session.prepare(action)` (pure; computes next state without committing).
5. **write-ahead persist** (`store.appendAction`) — durable before visible. On failure the seq is
   **not** advanced, so the client can safely retry.
6. `session.commit` → broadcast a **per-recipient redacted snapshot** + cosmetic events.

`src/game/game-session.ts` wraps the engine: `prepare` (pure) / `commit` (apply) so the hub can
persist between them; `apply` = prepare+commit; `restore` rebuilds from a snapshot + action tail,
**verifying each digest** (recovery aborts on divergence). `project(viewer)` = the engine's `redactFor`.

### The codec seam

`src/codec/` is the only place engine types ⇄ proto types: `enums`, `snapshot` (`viewToSnapshot`),
`events`, `commands` (`commandToAction`), `frames`. When you add an engine action/event or a rule
violation code, you touch the codec here **and** the `.proto` (regenerate it) **and**
`@trm/shared/errors` — all four stay 1:1.

## Hidden-information egress guard

`hub.sendProjected` builds the per-viewer snapshot via `redactFor` and asserts a snapshot's private
`you` block belongs to the recipient before sending; a mismatch increments
`trm_security_leak_blocked_total` and drops the frame. Never send raw `GameState`; all egress is the
projection. The wire-level leak test (`test/wire-game.e2e.spec.ts`) decodes every frame to non-owners
and asserts no secrets appear — keep it passing.

## Persistence & recovery (event sourcing)

`src/persistence/` + `src/db/`. `MongoGameStore` (native driver) is an append-only log: a genesis
snapshot, one `gameEvents` doc per action carrying the resulting `stateDigest`, periodic full
`gameSnapshots`, and a `matchHistory` archive on completion. The unique `(gameId, seq)` index is the
durable double-apply guard. Recovery = latest snapshot + replay tail, digest-verified. No multi-doc
transactions — every write for a game is serialized by its command queue.

## Auth, lobby, bots

- `src/auth/` — guests are real `users` docs (`isGuest`, TTL); HS256 access tokens + rotating refresh
  tokens with **family reuse-detection** (single-doc CAS, no transactions). `token.service` also mints
  the short-lived ws-game ticket the gateway verifies on `ClientHello`.
- `src/lobby/` — rooms lifecycle with atomic seat CAS; `start` builds the `GameConfig`, calls
  `hub.createMatch`, and hands back a ws-ticket. Bot add/remove are host-only.
- `src/bots/` — a bot is an **ordinary seated player driven server-side**; the engine never knows.
  `policy.ts` ranks moves from the engine's own `legalActions` (so a bot can never make an illegal
  move) with difficulty-tuned heuristics; the choice is a deterministic function of `state + botId`.
  The hub's bot driver runs each bot through the **same** prepare→persist→commit→fan-out path as a
  human, and bot moves are logged actions, so replay/recovery are unaffected. The roster is persisted
  on the game doc and resumes after recovery. `TRM_BOT_DELAY_MS` paces moves (0 in tests).

`src/main.ts` wires helmet (CSP off so Scalar's CDN loads — tighten in prod), cookie-parser, CORS
allowlist, attaches the ws server, and builds the OpenAPI doc from the live app (Scalar at `/docs`,
JSON at `/api/openapi.json`). Validation + OpenAPI schemas come from **one zod source** via
`nestjs-zod` (ADR A3). Metrics at `/metrics` (prom-client).
