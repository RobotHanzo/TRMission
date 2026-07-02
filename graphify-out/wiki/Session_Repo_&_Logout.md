# Session Repo & Logout

> 15 nodes · cohesion 0.19

## Key Concepts

- **SessionRepo** (13 connections) — `apps/server/src/auth/session.repo.ts`
- **.rotate()** (6 connections) — `apps/server/src/auth/session.repo.ts`
- **.create()** (5 connections) — `apps/server/src/auth/session.repo.ts`
- **decode()** (4 connections) — `apps/server/src/auth/session.repo.ts`
- **.peekUserId()** (4 connections) — `apps/server/src/auth/session.repo.ts`
- **sha256()** (4 connections) — `apps/server/src/auth/session.repo.ts`
- **.constructor()** (3 connections) — `apps/server/src/auth/auth.service.ts`
- **.logout()** (3 connections) — `apps/server/src/auth/auth.service.ts`
- **encode()** (3 connections) — `apps/server/src/auth/session.repo.ts`
- **newSecret()** (3 connections) — `apps/server/src/auth/session.repo.ts`
- **.revoke()** (3 connections) — `apps/server/src/auth/session.repo.ts`
- **.revokeAllForUser()** (3 connections) — `apps/server/src/auth/session.repo.ts`
- **.logout()** (2 connections) — `apps/server/src/auth/auth.controller.ts`
- **.constructor()** (1 connections) — `apps/server/src/auth/session.repo.ts`
- **.onModuleInit()** (1 connections) — `apps/server/src/auth/session.repo.ts`

## Relationships

- [Auth Service](Auth_Service.md) (6 shared connections)
- [Server App Bootstrap](Server_App_Bootstrap.md) (6 shared connections)
- [Auth Controller Endpoints](Auth_Controller_Endpoints.md) (3 shared connections)
- [OAuth Service](OAuth_Service.md) (2 shared connections)
- [OAuth HTTP Client](OAuth_HTTP_Client.md) (1 shared connections)

## Source Files

- `apps/server/src/auth/auth.controller.ts`
- `apps/server/src/auth/auth.service.ts`
- `apps/server/src/auth/session.repo.ts`

## Audit Trail

- EXTRACTED: 58 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*