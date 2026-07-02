# Server Bootstrap

> 21 nodes · cohesion 0.17

## Key Concepts

- **asPlayerId()** (44 connections) — `packages/shared/src/ids.ts`
- **taiwanBoard()** (40 connections) — `packages/engine/src/taiwan.ts`
- **CONTENT_HASH** (29 connections) — `packages/map-data/src/index.ts`
- **main.ts** (15 connections) — `apps/server/src/main.ts`
- **sandboxSocket.test.ts** (13 connections) — `apps/web/src/net/sandboxSocket.test.ts`
- **history-session.spec.ts** (12 connections) — `apps/server/test/history-session.spec.ts`
- **dev-seed.ts** (11 connections) — `apps/server/src/dev-seed.ts`
- **ws-server.ts** (6 connections) — `apps/server/src/ws/ws-server.ts`
- **seedDevGame()** (5 connections) — `apps/server/src/dev-seed.ts`
- **buildOpenApiDocument()** (5 connections) — `apps/server/src/openapi/openapi.ts`
- **bootstrap()** (4 connections) — `apps/server/src/main.ts`
- **attachWsServer()** (4 connections) — `apps/server/src/ws/ws-server.ts`
- **configFor()** (4 connections) — `packages/engine/test/draw-rainbow.spec.ts`
- **AppModule** (3 connections) — `apps/server/src/app.module.ts`
- **cfg()** (3 connections) — `packages/engine/test/forcedTicketDraw.spec.ts`
- **cfg()** (3 connections) — `packages/engine/test/instant-completion.spec.ts`
- **makeSandbox()** (2 connections) — `apps/web/src/net/sandboxSocket.test.ts`
- **toUint8()** (1 connections) — `apps/server/src/ws/ws-server.ts`
- **config** (1 connections) — `apps/server/test/history-session.spec.ts`
- **p0** (1 connections) — `apps/web/src/net/sandboxSocket.test.ts`
- **p1** (1 connections) — `apps/web/src/net/sandboxSocket.test.ts`

## Relationships

- [Server E2E Tests](Server_E2E_Tests.md) (29 shared connections)
- [Engine Setup & Tests](Engine_Setup_%26_Tests.md) (24 shared connections)
- [WebSocket Hub](WebSocket_Hub.md) (11 shared connections)
- [Board & Legal Actions](Board_%26_Legal_Actions.md) (9 shared connections)
- [Wire Codec](Wire_Codec.md) (9 shared connections)
- [Game Session & Persistence](Game_Session_%26_Persistence.md) (8 shared connections)
- [Server App Bootstrap](Server_App_Bootstrap.md) (7 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (5 shared connections)
- [Map-Data Content Registry](Map-Data_Content_Registry.md) (5 shared connections)
- [Tutorial System](Tutorial_System.md) (4 shared connections)
- [Auth/Lobby E2E Tests](Auth-Lobby_E2E_Tests.md) (3 shared connections)
- [Lobby Management](Lobby_Management.md) (3 shared connections)

## Source Files

- `apps/server/src/app.module.ts`
- `apps/server/src/dev-seed.ts`
- `apps/server/src/main.ts`
- `apps/server/src/openapi/openapi.ts`
- `apps/server/src/ws/ws-server.ts`
- `apps/server/test/history-session.spec.ts`
- `apps/web/src/net/sandboxSocket.test.ts`
- `packages/engine/src/taiwan.ts`
- `packages/engine/test/draw-rainbow.spec.ts`
- `packages/engine/test/forcedTicketDraw.spec.ts`
- `packages/engine/test/instant-completion.spec.ts`
- `packages/map-data/src/index.ts`
- `packages/shared/src/ids.ts`

## Audit Trail

- EXTRACTED: 207 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*