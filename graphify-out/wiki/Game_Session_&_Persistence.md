# Game Session & Persistence

> 57 nodes · cohesion 0.07

## Key Concepts

- **GameState** (55 connections) — `packages/engine/src/types/state.ts`
- **GameConfig** (45 connections) — `packages/engine/src/config.ts`
- **Action** (44 connections) — `packages/engine/src/types/actions.ts`
- **types.ts** (29 connections) — `apps/server/src/persistence/types.ts`
- **game-store.ts** (27 connections) — `apps/server/src/persistence/game-store.ts`
- **GameSession** (25 connections) — `apps/server/src/game/game-session.ts`
- **game-session.ts** (24 connections) — `apps/server/src/game/game-session.ts`
- **MongoGameStore** (19 connections) — `apps/server/src/persistence/game-store.ts`
- **GameStorePort** (16 connections) — `apps/server/src/persistence/types.ts`
- **stateDigest()** (14 connections) — `packages/engine/src/serialize.ts`
- **frameTarget.test.ts** (11 connections) — `apps/web/src/features/replay/frameTarget.test.ts`
- **RuleParams** (9 connections) — `packages/shared/src/constants.ts`
- **.restore()** (8 connections) — `apps/server/src/game/game-session.ts`
- **RecoveryData** (7 connections) — `apps/server/src/persistence/types.ts`
- **GameEventDoc** (6 connections) — `apps/server/src/persistence/types.ts`
- **.apply()** (5 connections) — `apps/server/src/game/game-session.ts`
- **.prepare()** (5 connections) — `apps/server/src/game/game-session.ts`
- **Prepared** (5 connections) — `apps/server/src/game/game-session.ts`
- **.createGame()** (5 connections) — `apps/server/src/persistence/game-store.ts`
- **.constructor()** (4 connections) — `apps/server/src/game/game-session.ts`
- **ReplayData** (4 connections) — `apps/server/src/history/history.repo.ts`
- **ChatEntry** (4 connections) — `apps/server/src/persistence/types.ts`
- **GameSnapshotDoc** (4 connections) — `apps/server/src/persistence/types.ts`
- **.createGame()** (4 connections) — `apps/server/src/persistence/types.ts`
- **StoredConfig** (4 connections) — `apps/server/src/persistence/types.ts`
- _... and 32 more nodes in this community_

## Relationships

- [Server E2E Tests](Server_E2E_Tests.md) (33 shared connections)
- [Engine Setup & Tests](Engine_Setup_%26_Tests.md) (32 shared connections)
- [Board & Legal Actions](Board_%26_Legal_Actions.md) (23 shared connections)
- [WebSocket Hub](WebSocket_Hub.md) (21 shared connections)
- [Engine State/View Types](Engine_State-View_Types.md) (20 shared connections)
- [Wire Codec](Wire_Codec.md) (19 shared connections)
- [History & SDD Docs](History_%26_SDD_Docs.md) (14 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (12 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (8 shared connections)
- [Sandbox Socket](Sandbox_Socket.md) (6 shared connections)
- [Tutorial System](Tutorial_System.md) (6 shared connections)
- [Core Reducer & Payments](Core_Reducer_%26_Payments.md) (5 shared connections)

## Source Files

- `apps/server/src/game/game-session.ts`
- `apps/server/src/history/history.repo.ts`
- `apps/server/src/persistence/game-store.ts`
- `apps/server/src/persistence/types.ts`
- `apps/server/test/chat-store.spec.ts`
- `apps/web/src/features/replay/frameTarget.test.ts`
- `apps/web/src/net/sandboxSocket.ts`
- `packages/engine/src/config.ts`
- `packages/engine/src/serialize.ts`
- `packages/engine/src/turn.ts`
- `packages/engine/src/types/actions.ts`
- `packages/engine/src/types/state.ts`
- `packages/shared/src/constants.ts`

## Audit Trail

- EXTRACTED: 450 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
