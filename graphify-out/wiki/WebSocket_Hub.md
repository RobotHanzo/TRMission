# WebSocket Hub

> 45 nodes · cohesion 0.12

## Key Concepts

- **hub.ts** (69 connections) — `apps/server/src/ws/hub.ts`
- **GameHub** (44 connections) — `apps/server/src/ws/hub.ts`
- **Connection** (16 connections) — `apps/server/src/ws/connection.ts`
- **BotProfile** (15 connections) — `apps/server/src/bots/types.ts`
- **Match** (13 connections) — `apps/server/src/game/game-registry.ts`
- **.onHello()** (12 connections) — `apps/server/src/ws/hub.ts`
- **frames.ts** (11 connections) — `packages/codec/src/frames.ts`
- **connection.ts** (9 connections) — `apps/server/src/ws/connection.ts`
- **.sendProjected()** (9 connections) — `apps/server/src/ws/hub.ts`
- **.broadcast()** (8 connections) — `apps/server/src/ws/hub.ts`
- **.createMatch()** (8 connections) — `apps/server/src/ws/hub.ts`
- **.driveBots()** (8 connections) — `apps/server/src/ws/hub.ts`
- **.receive()** (8 connections) — `apps/server/src/ws/hub.ts`
- **.botMove()** (7 connections) — `apps/server/src/ws/hub.ts`
- **.onResync()** (7 connections) — `apps/server/src/ws/hub.ts`
- **rejectionFrame()** (7 connections) — `packages/codec/src/frames.ts`
- **.onGameCommand()** (6 connections) — `apps/server/src/ws/hub.ts`
- **.recoverMatch()** (6 connections) — `apps/server/src/ws/hub.ts`
- **.sendHistory()** (6 connections) — `apps/server/src/ws/hub.ts`
- **.sendSnapshot()** (6 connections) — `apps/server/src/ws/hub.ts`
- **.get()** (5 connections) — `apps/server/src/game/game-registry.ts`
- **bot-pacing.ts** (5 connections) — `apps/server/src/ws/bot-pacing.ts`
- **.applyPrepared()** (5 connections) — `apps/server/src/ws/hub.ts`
- **.nextActableBot()** (5 connections) — `apps/server/src/ws/hub.ts`
- **.onChat()** (5 connections) — `apps/server/src/ws/hub.ts`
- _... and 20 more nodes in this community_

## Relationships

- [Server E2E Tests](Server_E2E_Tests.md) (27 shared connections)
- [Game Session & Persistence](Game_Session_%26_Persistence.md) (21 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (11 shared connections)
- [Metrics Hooks & WS Ticket Auth](Metrics_Hooks_%26_WS_Ticket_Auth.md) (11 shared connections)
- [Wire Codec](Wire_Codec.md) (10 shared connections)
- [Engine State/View Types](Engine_State-View_Types.md) (6 shared connections)
- [Bot Types & Room Repo](Bot_Types_%26_Room_Repo.md) (5 shared connections)
- [Board & Legal Actions](Board_%26_Legal_Actions.md) (5 shared connections)
- [History & SDD Docs](History_%26_SDD_Docs.md) (4 shared connections)
- [Auth/Lobby E2E Tests](Auth-Lobby_E2E_Tests.md) (4 shared connections)
- [Animation Model & Cards](Animation_Model_%26_Cards.md) (3 shared connections)
- [Bot AI Policy](Bot_AI_Policy.md) (3 shared connections)

## Source Files

- `apps/server/src/bots/types.ts`
- `apps/server/src/game/game-registry.ts`
- `apps/server/src/ws/bot-pacing.ts`
- `apps/server/src/ws/connection.ts`
- `apps/server/src/ws/hub.ts`
- `apps/server/test/bot-pacing.spec.ts`
- `packages/codec/src/frames.ts`

## Audit Trail

- EXTRACTED: 355 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
