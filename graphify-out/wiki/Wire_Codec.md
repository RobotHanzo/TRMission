# Wire Codec

> 47 nodes · cohesion 0.08

## Key Concepts

- **sandboxSocket.ts** (32 connections) — `apps/web/src/net/sandboxSocket.ts`
- **useReplayPlayer.ts** (30 connections) — `apps/web/src/features/replay/useReplayPlayer.ts`
- **codec.spec.ts** (25 connections) — `apps/server/test/codec.spec.ts`
- **GameEvent** (21 connections) — `packages/engine/src/types/events.ts`
- **enums.ts** (20 connections) — `packages/codec/src/enums.ts`
- **codec.spec.ts** (19 connections) — `packages/codec/test/codec.spec.ts`
- **snapshot.ts** (17 connections) — `packages/codec/src/snapshot.ts`
- **index.ts** (16 connections) — `packages/codec/src/index.ts`
- **commands.ts** (15 connections) — `packages/codec/src/commands.ts`
- **viewToSnapshot()** (14 connections) — `packages/codec/src/snapshot.ts`
- **ids.ts** (14 connections) — `packages/shared/src/ids.ts`
- **events.ts** (12 connections) — `packages/codec/src/events.ts`
- **redactFor()** (12 connections) — `packages/engine/src/selectors.ts`
- **asRouteId()** (11 connections) — `packages/shared/src/ids.ts`
- **commandToAction()** (10 connections) — `packages/codec/src/commands.ts`
- **eventToProto()** (9 connections) — `packages/codec/src/events.ts`
- **asTicketId()** (8 connections) — `packages/shared/src/ids.ts`
- **cardOrNullToPb()** (6 connections) — `packages/codec/src/enums.ts`
- **ReduceOutput** (6 connections) — `packages/engine/src/reduce.ts`
- **protoPayment()** (3 connections) — `packages/codec/src/commands.ts`
- **cardToPb()** (3 connections) — `packages/codec/src/enums.ts`
- **pbToTrainColorOrNull()** (3 connections) — `packages/codec/src/enums.ts`
- **phaseToPb()** (3 connections) — `packages/codec/src/enums.ts`
- **decodeClient()** (2 connections) — `apps/server/test/helpers.ts`
- **rejectionToPb()** (2 connections) — `packages/codec/src/enums.ts`
- _... and 22 more nodes in this community_

## Relationships

- [Game Session & Persistence](Game_Session_%26_Persistence.md) (19 shared connections)
- [Engine State/View Types](Engine_State-View_Types.md) (19 shared connections)
- [Board & Legal Actions](Board_%26_Legal_Actions.md) (16 shared connections)
- [Engine Setup & Tests](Engine_Setup_%26_Tests.md) (14 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (12 shared connections)
- [WebSocket Hub](WebSocket_Hub.md) (10 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (9 shared connections)
- [Map Data Content](Map_Data_Content.md) (9 shared connections)
- [Animation Model & Cards](Animation_Model_%26_Cards.md) (8 shared connections)
- [Server E2E Tests](Server_E2E_Tests.md) (7 shared connections)
- [Sandbox Socket](Sandbox_Socket.md) (7 shared connections)
- [Game Command Definitions](Game_Command_Definitions.md) (5 shared connections)

## Source Files

- `apps/server/test/codec.spec.ts`
- `apps/server/test/helpers.ts`
- `apps/web/src/features/replay/useReplayPlayer.ts`
- `apps/web/src/net/sandboxSocket.ts`
- `packages/codec/src/commands.ts`
- `packages/codec/src/enums.ts`
- `packages/codec/src/events.ts`
- `packages/codec/src/index.ts`
- `packages/codec/src/snapshot.ts`
- `packages/codec/test/codec.spec.ts`
- `packages/engine/src/reduce.ts`
- `packages/engine/src/selectors.ts`
- `packages/engine/src/types/events.ts`
- `packages/shared/src/ids.ts`

## Audit Trail

- EXTRACTED: 336 (99%)
- INFERRED: 2 (1%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
