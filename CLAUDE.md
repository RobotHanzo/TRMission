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
yarn workspace @trm/admin dev          # maintainer dashboard on :5174/admin/ (proxies /api → :3001)
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
- **Stay on `main`.** Don't switch branches (`git checkout`/`switch`) unless the user explicitly
  asks for a different branch for that task.
- **If a worktree is used for a task, merge it back to `main` locally once all phases/tasks in
  that task are done** — don't leave finished worktree work stranded on its branch.

## Plans

Implementation plans for this repo live in `docs/plans/`, one file per plan named
`YYYY-MM-DD-<topic>.md` (date the plan was written + short kebab-case topic). When you produce a
plan for work in this repo — plan mode or otherwise — save it there under that naming scheme, not
in `~/.claude/plans/` or anywhere else.

## Monorepo layout & build order

```
packages/proto  → shared → map-data → engine → bots/codec → client-core → apps/{server,web,admin,mobile}
```

- `@trm/shared` — enums, scoring/rule constants, **seeded counter PRNG**, ids, error taxonomy, digest.
- `@trm/map-data` — the authored Taiwan content (cities/routes/tickets) + `validate()` + `CONTENT_HASH`.
- `@trm/engine` — the **pure deterministic reducer** (rules, scoring, longest-trail, connectivity).
- `@trm/bots` — the pure bot policy (`chooseBotAction`: ranks the engine's own `legalActions`
  with difficulty heuristics; deterministic per state+botId). Shared by the server's bot
  driver and the mobile app's offline games.
- `@trm/proto` — protobuf-es wire protocol (the engine⇄wire contract).
- `@trm/client-core` — the **shared headless client core** for web + mobile: REST client (platform
  transports injected), `GameSocket`, `SandboxSocket`, zustand stores (game/chat/log/animations),
  game view logic (payments/tunnel/events/tickets/content catalog), the tutorial core
  (types/curriculum/focus/scenario player + tutorial i18n), and card/cartography colour tokens.
  `react`/`zustand`/`i18next` are peerDependencies — keep both apps pinned to the SAME react
  version (pinned exactly; a second nested copy splits module identity and breaks hooks).
- `apps/server` — NestJS: WebSocket gateway + REST (auth/lobby/history/dashboard) + Mongo + OpenAPI + bots.
- `apps/web` — React + Vite + TS: SVG board, realtime client, i18n, zustand.
- `apps/admin` — the maintainer dashboard (REST-only React app, deployed same-origin under
  `/admin/`). Dashboard access lives in the `dashboardAccounts` collection (role + per-account
  permission overrides referencing `users._id`); the permission taxonomy is in `@trm/shared`.
  A LIVE game's hidden info (state, action log, even the seed) never reaches this surface.
- `apps/mobile` — React Native + Expo client (`@trm/mobile`); reuses the TS packages and
  authenticates against the P0 mobile server surface (guest/password/Google/Apple/Discord). Point it
  at a server with `TRM_SERVER_ORIGIN` (the app is not served same-origin — absolute API/WS base +
  token-in-body refresh). Builds via GitHub Actions + fastlane (no EAS). See its `CLAUDE.md`.

Internal packages export **TS source** (no per-lib build step) except `proto` (codegen). Each area
has its own `CLAUDE.md` with the local architecture — read it before working there.

**`apps/web` and `apps/mobile` are two clients over the same game, sharing one headless core.**
Client logic (net, stores, game view logic, tutorial core, colour tokens) lives ONCE in
`@trm/client-core`; only rendering stays platform-native (DOM/SVG on web, RN/Skia on mobile),
kept separate where performance, aesthetics, or platform features justify it. **Never implement
the same logic twice across the two apps** — extract it to `@trm/client-core` instead (app-side
files that moved are thin re-export shims, so component import paths stay stable). Presentation
changes (a screen, an animation, notification copy) still need a per-platform pass: when you land
one side, check whether the other client needs the equivalent before calling the work done.

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
  replay crosses engine versions only through an explicit compatibility allowlist (mobile offline
  resume remains exact-version pinned). `CONTENT_HASH` is derived from the authored content, so any map
  edit changes it.
- **Naming/tooling pins.** The 6th card colour is **PURPLE** everywhere (never PINK). Seat colours
  are abstract indices 0–5 on the wire, coloured client-side (seat 5 exists only for the 6-player
  team layouts). `apps/web` pins **Vite ^5** for vitest 2 compatibility — do not bump to Vite 6.
- **Team mode is opt-in per room and structurally inert when off.** `RoomSettings.teamCount`
  (0 = free-for-all, 2 or 3) becomes `GameConfig.teamCount`; membership is `seat % teamCount`, so
  arranging teams in the lobby IS reordering seats (`POST /rooms/:code/seats`). Teams share a
  network for tickets + one combined longest-trail bonus, see each other's tickets but never each
  other's hands, and pass cards only through a public per-team pool. See `packages/engine/CLAUDE.md`
  for why no `RuleParams` field was added (it would have changed every existing game's digest).

## Server env vars

The full env-var reference (core, mobile/push, auth/OAuth) lives in `apps/server/CLAUDE.md` —
read it before configuring or running the server.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
