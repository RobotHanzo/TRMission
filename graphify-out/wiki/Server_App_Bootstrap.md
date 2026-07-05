# Server App Bootstrap

> 35 nodes · cohesion 0.12

## Key Concepts

- **common.ts** (46 connections) — `packages/engine/src/reducers/common.ts`
- **auth.module.ts** (23 connections) — `apps/server/src/auth/auth.module.ts`
- **app.module.ts** (22 connections) — `apps/server/src/app.module.ts`
- **game.module.ts** (18 connections) — `apps/server/src/game/game.module.ts`
- **auth-config.ts** (16 connections) — `apps/server/src/auth/auth-config.ts`
- **lobby.module.ts** (15 connections) — `apps/server/src/lobby/lobby.module.ts`
- **session.repo.ts** (13 connections) — `apps/server/src/auth/session.repo.ts`
- **database.module.ts** (10 connections) — `apps/server/src/db/database.module.ts`
- **env.ts** (9 connections) — `apps/server/src/config/env.ts`
- **env** (9 connections) — `apps/server/src/config/env.ts`
- **history.module.ts** (9 connections) — `apps/server/src/history/history.module.ts`
- **OpenApiHolder** (8 connections) — `apps/server/src/openapi/openapi.holder.ts`
- **health.controller.ts** (6 connections) — `apps/server/src/health/health.controller.ts`
- **openapi.holder.ts** (6 connections) — `apps/server/src/openapi/openapi.holder.ts`
- **AuthModule** (5 connections) — `apps/server/src/auth/auth.module.ts`
- **docs.controller.ts** (5 connections) — `apps/server/src/openapi/docs.controller.ts`
- **DocsController** (5 connections) — `apps/server/src/openapi/docs.controller.ts`
- **HealthController** (4 connections) — `apps/server/src/health/health.controller.ts`
- **mongo.ts** (3 connections) — `apps/server/src/db/mongo.ts`
- **GameModule** (3 connections) — `apps/server/src/game/game.module.ts`
- **DatabaseModule** (2 connections) — `apps/server/src/db/database.module.ts`
- **connectMongo()** (2 connections) — `apps/server/src/db/mongo.ts`
- **HistoryModule** (2 connections) — `apps/server/src/history/history.module.ts`
- **LobbyModule** (2 connections) — `apps/server/src/lobby/lobby.module.ts`
- **.constructor()** (2 connections) — `apps/server/src/openapi/docs.controller.ts`
- _... and 10 more nodes in this community_

## Relationships

- [Auth Service](Auth_Service.md) (10 shared connections)
- [Lobby Management](Lobby_Management.md) (9 shared connections)
- [Core Reducer & Payments](Core_Reducer_%26_Payments.md) (8 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (7 shared connections)
- [Metrics Controller & Service](Metrics_Controller_%26_Service.md) (7 shared connections)
- [OAuth HTTP Client](OAuth_HTTP_Client.md) (7 shared connections)
- [Auth Schemas](Auth_Schemas.md) (7 shared connections)
- [OAuth Service](OAuth_Service.md) (6 shared connections)
- [Session Repo & Logout](Session_Repo_%26_Logout.md) (6 shared connections)
- [History & SDD Docs](History_%26_SDD_Docs.md) (6 shared connections)
- [Auth/Lobby E2E Tests](Auth-Lobby_E2E_Tests.md) (5 shared connections)
- [Game Session & Persistence](Game_Session_%26_Persistence.md) (5 shared connections)

## Source Files

- `apps/server/src/app.module.ts`
- `apps/server/src/auth/auth-config.ts`
- `apps/server/src/auth/auth.module.ts`
- `apps/server/src/auth/session.repo.ts`
- `apps/server/src/config/env.ts`
- `apps/server/src/db/database.module.ts`
- `apps/server/src/db/mongo.ts`
- `apps/server/src/game/game.module.ts`
- `apps/server/src/health/health.controller.ts`
- `apps/server/src/history/history.module.ts`
- `apps/server/src/lobby/lobby.module.ts`
- `apps/server/src/openapi/docs.controller.ts`
- `apps/server/src/openapi/openapi.holder.ts`
- `packages/engine/src/reducers/common.ts`

## Audit Trail

- EXTRACTED: 257 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
