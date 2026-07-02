# Auth/Lobby E2E Tests

> 31 nodes · cohesion 0.12

## Key Concepts

- **app.ts** (27 connections) — `apps/server/test/app.ts`
- **lobby.e2e.spec.ts** (19 connections) — `apps/server/test/lobby.e2e.spec.ts`
- **lobby-spectate.e2e.spec.ts** (13 connections) — `apps/server/test/lobby-spectate.e2e.spec.ts`
- **createTestApp()** (9 connections) — `apps/server/test/app.ts`
- **TestApp** (9 connections) — `apps/server/test/app.ts`
- **auth.e2e.spec.ts** (9 connections) — `apps/server/test/auth.e2e.spec.ts`
- **lobby-settings.e2e.spec.ts** (8 connections) — `apps/server/test/lobby-settings.e2e.spec.ts`
- **lobby-bots.e2e.spec.ts** (6 connections) — `apps/server/test/lobby-bots.e2e.spec.ts`
- **FakeOauthHttp** (5 connections) — `apps/server/test/app.ts`
- **OauthProfile** (4 connections) — `apps/server/src/auth/oauth.http.ts`
- **docs.e2e.spec.ts** (4 connections) — `apps/server/test/docs.e2e.spec.ts`
- **startedRoom()** (4 connections) — `apps/server/test/lobby-spectate.e2e.spec.ts`
- **guest()** (3 connections) — `apps/server/test/lobby-spectate.e2e.spec.ts`
- **server()** (3 connections) — `apps/server/test/lobby-spectate.e2e.spec.ts`
- **.getProfile()** (2 connections) — `apps/server/test/app.ts`
- **OAUTH_TEST_CONFIG** (2 connections) — `apps/server/test/app.ts`
- **refreshCookie()** (2 connections) — `apps/server/test/app.ts`
- **guest()** (2 connections) — `apps/server/test/lobby-bots.e2e.spec.ts`
- **server()** (2 connections) — `apps/server/test/lobby-bots.e2e.spec.ts`
- **guest()** (2 connections) — `apps/server/test/lobby.e2e.spec.ts`
- **server()** (2 connections) — `apps/server/test/lobby.e2e.spec.ts`
- **guest()** (2 connections) — `apps/server/test/lobby-settings.e2e.spec.ts`
- **server()** (2 connections) — `apps/server/test/lobby-settings.e2e.spec.ts`
- **auth()** (2 connections) — `apps/server/test/lobby-spectate.e2e.spec.ts`
- **.close()** (1 connections) — `apps/server/test/app.ts`
- *... and 6 more nodes in this community*

## Relationships

- [Server E2E Tests](Server_E2E_Tests.md) (15 shared connections)
- [OAuth HTTP Client](OAuth_HTTP_Client.md) (7 shared connections)
- [Server App Bootstrap](Server_App_Bootstrap.md) (5 shared connections)
- [WebSocket Hub](WebSocket_Hub.md) (4 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (3 shared connections)
- [Animation Model & Cards](Animation_Model_%26_Cards.md) (3 shared connections)
- [Auth Provider Config](Auth_Provider_Config.md) (1 shared connections)
- [Lobby Management](Lobby_Management.md) (1 shared connections)
- [History & SDD Docs](History_%26_SDD_Docs.md) (1 shared connections)
- [Engine State/View Types](Engine_State-View_Types.md) (1 shared connections)
- [Board & Legal Actions](Board_%26_Legal_Actions.md) (1 shared connections)

## Source Files

- `apps/server/src/auth/oauth.http.ts`
- `apps/server/test/app.ts`
- `apps/server/test/auth.e2e.spec.ts`
- `apps/server/test/docs.e2e.spec.ts`
- `apps/server/test/lobby-bots.e2e.spec.ts`
- `apps/server/test/lobby-settings.e2e.spec.ts`
- `apps/server/test/lobby-spectate.e2e.spec.ts`
- `apps/server/test/lobby.e2e.spec.ts`

## Audit Trail

- EXTRACTED: 150 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*