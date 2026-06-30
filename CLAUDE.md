# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TRMission (台鐵任務) is a multiplayer web board game: a **clean-room reimplementation of the
_mechanics_** of _Ticket to Ride: Europe_, re-themed onto Taiwan's railways. The map, city graph,
all artwork, the colour palette, and the rules wording are **original** — only the underlying
mechanics and real Taiwanese place-names are reused. The rulebook PDF is a mechanical reference
only; never copy artwork, names, layout, or verbatim rules text. UI ships in **Traditional Chinese
(primary) + English**.

## Commands

Yarn 4 (via Corepack) + Turborepo. Node 20+.

```bash
yarn install
yarn build            # turbo: proto codegen + per-package builds (respects dep graph)
yarn typecheck        # tsc --noEmit across all workspaces
yarn lint             # eslint . (engine purity rules enforced structurally)
yarn test             # turbo run test (vitest) across all workspaces
yarn format           # prettier --write; format:check is the CI gate

# One workspace / one test file (vitest substring match on file path):
yarn workspace @trm/server test --run bots.e2e
yarn workspace @trm/engine test --run longestTrail
yarn workspace @trm/proto generate     # regenerate src/gen/ from .proto (buf)

# Dev loop (needs Docker for Mongo):
docker compose up -d mongo             # Mongo on :27017
yarn workspace @trm/server dev         # REST + ws on :3001, Scalar docs at /docs
yarn workspace @trm/web dev            # app on :5173 (proxies /api + /ws → :3001)
```

`turbo test`/`typecheck` depend on `^build` + `build`, so `@trm/proto` codegen always runs first.
After editing a `.proto`, regenerate (`yarn workspace @trm/proto generate`) — `src/gen/**` is
gitignored and a drift between it and the `.proto` is a CI failure.

## Git workflow

- **Commit automatically once your work is done and validated** (relevant build/typecheck/lint/test
  commands pass), unless the user says otherwise for that task. Don't wait to be asked — land
  validated work in a commit by default.
- **Multiple agents may be working in this worktree at the same time.** Before committing, check
  `git status`/`git diff` and stage only the files your own session actually changed. Never use
  `git add -A`/`git add .` here — it can sweep up another session's in-progress or unrelated
  changes into your commit.

## Monorepo layout & build order

```
packages/proto  → shared → map-data → engine → apps/{server,web}
```

- `@trm/shared` — enums, scoring/rule constants, **seeded counter PRNG**, ids, error taxonomy, digest.
- `@trm/map-data` — the authored Taiwan content (cities/routes/tickets) + `validate()` + `CONTENT_HASH`.
- `@trm/engine` — the **pure deterministic reducer** (rules, scoring, longest-trail, connectivity).
- `@trm/proto` — protobuf-es wire protocol (the engine⇄wire contract).
- `apps/server` — NestJS: WebSocket gateway + REST (auth/lobby/history) + Mongo + OpenAPI + bots.
- `apps/web` — React + Vite + TS: SVG board, realtime client, i18n, zustand.

Internal packages export **TS source** (no per-lib build step) except `proto` (codegen). Each area
has its own `CLAUDE.md` with the local architecture — read it before working there.

## The big picture

**Server-authoritative + deterministic.** Every game is hidden-information (each hand and ticket is
secret), so the server is the sole source of truth and never trusts the client. The whole system is
built around the engine being a pure function `reduce(state, action) → { state, events }` with zero
I/O. The same action log replays byte-identically (verified by a key-sorted SHA-256 `stateDigest`),
which is what makes crash recovery, reconnection, audit, anti-cheat, and bots all possible.

Two communication planes:

- **Realtime** — protobuf binary frames over WebSocket (`/ws`): all in-game actions + live state.
- **Control** — a REST API (auth, lobby, history) with **dynamically-generated OpenAPI** rendered by
  **Scalar** at `/docs`. A `POST /rooms/:code/start` mints a short-lived **ws-game ticket** (JWT)
  that the client presents as its first WS frame (`ClientHello`) to bind a socket to a seat.

The engine⇄proto⇄wire seam lives in `apps/server/src/codec/`. The hub
(`apps/server/src/ws/hub.ts`) is the critical loop: decode → serialize through a per-game queue →
write-ahead persist → commit on the engine → fan out a **per-recipient redacted snapshot**.

## Load-bearing decisions (these bite if you don't know them)

These mirror the ADRs in the development plan; treat them as binding.

- **Determinism is enforced structurally.** `@trm/engine` is ESLint-banned from `Date`,
  `Math.random`, `crypto.randomUUID`, and `new Date()`. All randomness comes from the seeded
  integer counter PRNG in `@trm/shared`. Golden-replay digests are a CI gate. Never introduce
  wall-clock or unseeded randomness into the engine.
- **Hidden information is structural, not a filter.** Opponents are a counts-only wire type
  (`PublicPlayerState`); a viewer's secrets live in a disjoint `SelfView`. The single `redactFor`
  projection is the only thing that should ever reach the wire, backed by a runtime egress guard and
  the `trm_security_leak_blocked_total` metric (alert on any increase). Raw `GameState` must never
  be serialized to a client.
- **swc, not tsx.** NestJS DI resolves constructor deps from emitted decorator metadata, which
  esbuild/tsx does **not** produce. Server `dev`/`start` run via `@swc-node/register`; vitest uses
  `unplugin-swc`. Don't switch these to tsx/esbuild — DI silently breaks at runtime.
- **Single-writer per game.** A per-game command queue serializes decode→validate→apply→persist→
  fan-out; a unique `(gameId, seq)` Mongo index is the durable double-apply guard. Idempotency is on
  the monotonic per-socket `client_seq`.
- **Version pins.** `engineVersion` + `contentHash` + `schemaVersion` are stamped on persisted games;
  replay refuses to cross versions. `CONTENT_HASH` is derived from the authored content, so any map
  edit changes it.
- **Naming/tooling pins.** The 6th card colour is **PURPLE** everywhere (never PINK). Seat colours
  are abstract indices 0–4 on the wire, coloured client-side. `apps/web` pins **Vite ^5** for vitest
  2 compatibility — do not bump to Vite 6.

## Server env vars

`PORT`, `MONGO_URL`, `MONGO_DB`, `JWT_SECRET` (set in prod), `CORS_ORIGINS` (comma list),
`COOKIE_SECURE`, `TRM_PERSISTENCE` (`0` = in-memory, no auth/lobby), `TRM_DEV_GAME` (`1` = seed a
demo game on boot), `TRM_BOT_DELAY_MS` (pause between bot moves; `0` in tests),
`JWT_ACCESS_TTL`, `WS_TICKET_TTL`, `REFRESH_TTL_MS`, `GUEST_TTL_MS`.

**Auth methods** (each independently switchable; the web reads `GET /auth/config`, the server
enforces): `AUTH_PASSWORD_LOGIN_ENABLED` (`0` disables email/password login+register+upgrade),
`AUTH_GUEST_ENABLED` (`0` disables guest sessions). **OAuth** (bound by *verified* email — same
email = same account across providers + password): `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`,
`DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` (a provider is enabled only when both are set),
`OAUTH_REDIRECT_BASE` (public base URL — builds the provider `redirect_uri` and the post-callback
web redirect; **must be the same origin that serves the SPA** so the Strict refresh cookie survives
the callback), `OAUTH_STATE_TTL_MS` (signed-state + nonce-cookie lifetime, ms). OAuth carries the
provider avatar URL onto the account for display.
