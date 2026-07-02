# Auth Provider Config

> 8 nodes · cohesion 0.25

## Key Concepts

- **AuthConfig** (12 connections) — `apps/server/src/auth/auth-config.ts`
- **.constructor()** (4 connections) — `apps/server/src/auth/auth.controller.ts`
- **.constructor()** (2 connections) — `apps/server/src/auth/auth-config.ts`
- **makeProvider()** (2 connections) — `apps/server/src/auth/auth-config.ts`
- **.callbackUrl()** (1 connections) — `apps/server/src/auth/auth-config.ts`
- **.provider()** (1 connections) — `apps/server/src/auth/auth-config.ts`
- **.publicConfig()** (1 connections) — `apps/server/src/auth/auth-config.ts`
- **.webCallback()** (1 connections) — `apps/server/src/auth/auth-config.ts`

## Relationships

- [Server App Bootstrap](Server_App_Bootstrap.md) (3 shared connections)
- [OAuth Service](OAuth_Service.md) (2 shared connections)
- [Auth Schemas](Auth_Schemas.md) (1 shared connections)
- [OAuth HTTP Client](OAuth_HTTP_Client.md) (1 shared connections)
- [Auth/Lobby E2E Tests](Auth-Lobby_E2E_Tests.md) (1 shared connections)
- [Auth Controller Endpoints](Auth_Controller_Endpoints.md) (1 shared connections)
- [Auth Service](Auth_Service.md) (1 shared connections)

## Source Files

- `apps/server/src/auth/auth-config.ts`
- `apps/server/src/auth/auth.controller.ts`

## Audit Trail

- EXTRACTED: 24 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*