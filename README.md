# 台鐵任務 · TRMission

A multiplayer web board game — a **clean-room reimplementation of the _mechanics_** of
a classic train-route game, re-themed onto **Taiwan's railways**. The map, the city
graph, all artwork, the colour palette, and the rules wording are **original**; only the
underlying mechanics and the real Taiwanese place-names are reused. Offered in
**Traditional Chinese (primary)** and **English**.

2–5 players claim coloured routes across an original Taiwan map (TRA / THSR / branch
lines), run ferries to the outlying islands, dig tunnels through the central mountains,
build stations, and race to complete secret destination tickets. Play as a guest or a
registered account, and the host can fill empty seats with **autonomous bots** (Easy /
Medium / Hard) so a short table still plays out.

## Architecture

A **server-authoritative** design with a **deterministic, replayable engine** — every
game is hidden-information (each hand and ticket is secret), so the server is the sole
source of truth and never trusts the client.

- **Realtime plane** — protobuf messages over WebSocket (`/ws`). The server applies each
  action through the pure engine and fans out per-recipient redacted snapshots.
- **Control plane** — a REST API (auth, lobby, match history) with a **dynamically
  generated OpenAPI** spec rendered by **Scalar** at `/docs`.
- **Persistence** — MongoDB, event-sourced: an append-only action log (+ periodic
  snapshots with a state digest) that replays deterministically through the engine for
  crash recovery and reconnection.

### Monorepo (Yarn workspaces + Turborepo)

```
packages/
  shared/    enums, scoring table, seeded counter-PRNG, ids, error taxonomy, digest
  map-data/  the authored Taiwan content (46 cities, 90 routes, 46 tickets) + validation
  engine/    pure deterministic reducer — rules, scoring, longest-trail, connectivity
  proto/     protobuf wire protocol (protobuf-es via buf) — the engine⇄wire contract
apps/
  server/    NestJS — WebSocket gateway + REST (auth/lobby/history) + Mongo + OpenAPI
  web/       React + Vite + TypeScript — SVG board, realtime client, i18n, zustand
```

## Quick start

Prerequisites: Node 20+ and Yarn 4 (via Corepack), plus Docker for MongoDB.

```bash
corepack enable
yarn install

docker compose up -d mongo          # MongoDB on :27017
yarn workspace @trm/server dev      # REST + ws on :3001, docs at /docs
yarn workspace @trm/web dev         # app on :5173 (proxies /api + /ws → :3001)
```

Open http://localhost:5173, sign in (guest or a registered account), create a room, share
the code — or add a few bots — and start. A lone player can fill the table with bots.

### Docker profiles

```bash
# mongo + server (dev mode, hot-reload) — run web locally on :5173
cp apps/server/.env.example apps/server/.env   # once; fill in secrets
docker compose --profile dev-server up --build

# full stack: mongo + server + web on http://localhost:8080
docker compose --profile full up --build
```

The `dev-server` profile sources configuration from `apps/server/.env` (see `.env.example`).
`MONGO_URL` is automatically overridden to reach the containerised MongoDB.

## Testing & quality

```bash
yarn build       # turbo: proto codegen + builds
yarn typecheck   # tsc across all packages
yarn lint        # eslint (engine purity rules enforced structurally)
yarn test        # vitest across all packages
```

The suite covers the deterministic engine (property + golden-replay), the protobuf
round-trip, a full game **over the wire** (determinism + a hidden-information leak check),
event-sourced **crash recovery**, auth (refresh rotation + reuse detection), the
lobby→game→history flow, an **anti-cheat / evil-client** suite, and the web (board render,
payment enumerator, stores).

## Key design decisions

- **Determinism** — the engine is a pure `reduce(state, action)` with all randomness from
  a seeded integer PRNG; a game replays byte-identically from its seed + action log.
- **Hidden information is structural** — opponents are a counts-only wire type; a viewer's
  secrets live in a disjoint `SelfView`. A single `redactFor` projection is the only
  egress, backed by a wire-level leak test and a runtime egress guard (metric:
  `trm_security_leak_blocked_total`, alert on any increase).
- **Single-writer per game** — a per-game command queue serializes decode→validate→apply→
  persist→fan-out; a unique `(gameId, seq)` index is the durable double-apply guard.
- **Auth** — guest play via room codes + optional accounts (argon2id); HS256 access tokens
  with rotating refresh tokens and reuse detection (no multi-document transactions needed).
  The web client surfaces the full flow — guest, sign-in, register, and stat-preserving
  guest→account upgrade — and resumes a session from the refresh cookie on reload.
- **Bots** — a bot is an ordinary seated player driven entirely server-side; the engine
  never knows it is a bot. The driver runs each bot through the same validate→persist→
  fan-out path as a human, choosing moves from the engine's own `legalActions` (so a bot
  can never make an illegal move). Difficulty (Easy/Medium/Hard) tunes ticket-routing,
  card drafting, station use, and randomness. Bot moves are logged actions, so replay and
  crash recovery are unaffected; the roster is persisted and resumes after recovery.

Observability: `/metrics` (Prometheus). Security: Helmet + rate limiting.

> The rulebook PDF is a mechanical reference only — no artwork, names, layout, or verbatim
> rules text are copied.
