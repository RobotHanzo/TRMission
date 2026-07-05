# Server E2E Tests

> 58 nodes · cohesion 0.07

## Key Concepts

- **persistence.spec.ts** (34 connections) — `apps/server/test/persistence.spec.ts`
- **helpers.ts** (32 connections) — `apps/server/test/helpers.ts`
- **spectators.spec.ts** (32 connections) — `apps/server/test/spectators.spec.ts`
- **wire-game.e2e.spec.ts** (30 connections) — `apps/server/test/wire-game.e2e.spec.ts`
- **history-replay.e2e.spec.ts** (28 connections) — `apps/server/test/history-replay.e2e.spec.ts`
- **bots.e2e.spec.ts** (26 connections) — `apps/server/test/bots.e2e.spec.ts`
- **game-registry.ts** (22 connections) — `apps/server/src/game/game-registry.ts`
- **history-chat.e2e.spec.ts** (22 connections) — `apps/server/test/history-chat.e2e.spec.ts`
- **ws-camera.e2e.spec.ts** (22 connections) — `apps/server/test/ws-camera.e2e.spec.ts`
- **GameRegistry** (20 connections) — `apps/server/src/game/game-registry.ts`
- **ws-transport.e2e.spec.ts** (20 connections) — `apps/server/test/ws-transport.e2e.spec.ts`
- **PlayerSeed** (17 connections) — `packages/engine/src/config.ts`
- **encodeClient()** (16 connections) — `apps/server/test/helpers.ts`
- **pickAction()** (12 connections) — `apps/server/test/helpers.ts`
- **GameDoc** (11 connections) — `apps/server/src/persistence/types.ts`
- **makeDevTicket()** (11 connections) — `apps/server/src/ws/ticket.ts`
- **decodeServer()** (10 connections) — `apps/server/test/helpers.ts`
- **actionToCommand()** (9 connections) — `apps/server/test/helpers.ts`
- **ensureIndexes()** (5 connections) — `apps/server/src/persistence/game-store.ts`
- **CommandQueue** (4 connections) — `apps/server/src/game/command-queue.ts`
- **.create()** (4 connections) — `apps/server/src/game/game-registry.ts`
- **driveToCompletion()** (4 connections) — `apps/server/test/spectators.spec.ts`
- **.adopt()** (3 connections) — `apps/server/src/game/game-registry.ts`
- **paymentToPb()** (3 connections) — `apps/server/test/helpers.ts`
- **hello()** (3 connections) — `apps/server/test/history-chat.e2e.spec.ts`
- _... and 33 more nodes in this community_

## Relationships

- [Game Session & Persistence](Game_Session_%26_Persistence.md) (33 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (29 shared connections)
- [WebSocket Hub](WebSocket_Hub.md) (27 shared connections)
- [Board & Legal Actions](Board_%26_Legal_Actions.md) (17 shared connections)
- [Metrics Hooks & WS Ticket Auth](Metrics_Hooks_%26_WS_Ticket_Auth.md) (16 shared connections)
- [Auth/Lobby E2E Tests](Auth-Lobby_E2E_Tests.md) (15 shared connections)
- [History & SDD Docs](History_%26_SDD_Docs.md) (13 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (11 shared connections)
- [Engine Setup & Tests](Engine_Setup_%26_Tests.md) (10 shared connections)
- [Engine State/View Types](Engine_State-View_Types.md) (9 shared connections)
- [Wire Codec](Wire_Codec.md) (7 shared connections)
- [Animation Model & Cards](Animation_Model_%26_Cards.md) (6 shared connections)

## Source Files

- `apps/server/src/game/command-queue.ts`
- `apps/server/src/game/game-registry.ts`
- `apps/server/src/persistence/game-store.ts`
- `apps/server/src/persistence/types.ts`
- `apps/server/src/ws/hub.ts`
- `apps/server/src/ws/ticket.ts`
- `apps/server/test/bots.e2e.spec.ts`
- `apps/server/test/helpers.ts`
- `apps/server/test/history-chat.e2e.spec.ts`
- `apps/server/test/history-replay.e2e.spec.ts`
- `apps/server/test/persistence.spec.ts`
- `apps/server/test/spectators.spec.ts`
- `apps/server/test/wire-game.e2e.spec.ts`
- `apps/server/test/ws-camera.e2e.spec.ts`
- `apps/server/test/ws-transport.e2e.spec.ts`
- `packages/engine/src/config.ts`

## Audit Trail

- EXTRACTED: 446 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
