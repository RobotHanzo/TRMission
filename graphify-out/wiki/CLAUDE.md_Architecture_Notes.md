# CLAUDE.md Architecture Notes

> 36 nodes · cohesion 0.06

## Key Concepts

- **GameHub (src/ws/hub.ts) — realtime dispatcher** (6 connections) — `apps/server/CLAUDE.md`
- **selectors.ts: legalActions, enumerateClaimPayments, redactFor** (6 connections) — `packages/engine/CLAUDE.md`
- **features/replay/ + ReplayScreen.tsx (client-side replay)** (4 connections) — `apps/web/CLAUDE.md`
- **reduce.ts: reduce(board, state, action) → ReduceResult** (4 connections) — `packages/engine/CLAUDE.md`
- **src/bots/ (bot driver + policy.ts)** (3 connections) — `apps/server/CLAUDE.md`
- **The Codec Seam (src/codec/)** (3 connections) — `apps/server/CLAUDE.md`
- **src/lobby/ (rooms lifecycle, atomic seat CAS)** (3 connections) — `apps/server/CLAUDE.md`
- **MongoGameStore (event-sourced persistence)** (3 connections) — `apps/server/CLAUDE.md`
- **store/session.ts (auth: guest/login/register/upgrade/restore)** (3 connections) — `apps/web/CLAUDE.md`
- **@trm/codec (engine⇄wire seam package)** (3 connections) — `packages/codec/CLAUDE.md`
- **src/auth/ (guests, JWT access/refresh, reuse detection)** (2 connections) — `apps/server/CLAUDE.md`
- **Per-Game Command Queue (game/command-queue.ts)** (2 connections) — `apps/server/CLAUDE.md`
- **GameSession (src/game/game-session.ts)** (2 connections) — `apps/server/CLAUDE.md`
- **HistoryRepo.loadReplay / GET /history/:gameId[/replay]** (2 connections) — `apps/server/CLAUDE.md`
- **OAuth Service (oauth.service + oauth.http, PKCE)** (2 connections) — `apps/server/CLAUDE.md`
- **components/Board.tsx (fluid SVG Taiwan board)** (2 connections) — `apps/web/CLAUDE.md`
- **net/connection.ts (socket ⇄ game store bridge)** (2 connections) — `apps/web/CLAUDE.md`
- **net/rest.ts (typed REST client)** (2 connections) — `apps/web/CLAUDE.md`
- **net/socket.ts (GameSocket protobuf WS client)** (2 connections) — `apps/web/CLAUDE.md`
- **store/game.ts (authoritative mirror)** (2 connections) — `apps/web/CLAUDE.md`
- **store/ui.ts (view routing, locale, colour-blind toggle)** (2 connections) — `apps/web/CLAUDE.md`
- **codec snapshot.ts: viewToSnapshot(view, stateVersion, viewer)** (2 connections) — `packages/codec/CLAUDE.md`
- **CONTENT_REGISTRY / resolveContentByHash / archive versioning** (2 connections) — `packages/map-data/CLAUDE.md`
- **@trm/map-data (authored Taiwan content)** (2 connections) — `packages/map-data/CLAUDE.md`
- **RejectionCode ⇄ RuleViolationCode 1:1 Mapping** (2 connections) — `packages/proto/CLAUDE.md`
- _... and 11 more nodes in this community_

## Relationships

- No strong cross-community connections detected

## Source Files

- `README.md`
- `apps/server/CLAUDE.md`
- `apps/web/CLAUDE.md`
- `apps/web/index.html`
- `apps/web/public/sounds/CREDITS.md`
- `packages/codec/CLAUDE.md`
- `packages/engine/CLAUDE.md`
- `packages/map-data/CLAUDE.md`
- `packages/proto/CLAUDE.md`
- `packages/shared/CLAUDE.md`

## Audit Trail

- EXTRACTED: 58 (72%)
- INFERRED: 18 (22%)
- AMBIGUOUS: 4 (5%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
