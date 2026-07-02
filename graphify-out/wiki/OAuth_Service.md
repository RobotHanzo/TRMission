# OAuth Service

> 15 nodes · cohesion 0.26

## Key Concepts

- **oauth.service.ts** (26 connections) — `apps/server/src/auth/oauth.service.ts`
- **OauthProvider** (11 connections) — `apps/server/src/auth/auth-config.ts`
- **.resolveAccount()** (11 connections) — `apps/server/src/auth/oauth.service.ts`
- **OauthService** (9 connections) — `apps/server/src/auth/oauth.service.ts`
- **.handleCallback()** (6 connections) — `apps/server/src/auth/oauth.service.ts`
- **.buildAuthorize()** (5 connections) — `apps/server/src/auth/oauth.service.ts`
- **safeRedirect()** (4 connections) — `apps/server/src/auth/oauth.service.ts`
- **.createOauthUser()** (4 connections) — `apps/server/src/auth/user.repo.ts`
- **.attachOauthToGuest()** (3 connections) — `apps/server/src/auth/user.repo.ts`
- **.linkOauthIdentity()** (3 connections) — `apps/server/src/auth/user.repo.ts`
- **base64url()** (2 connections) — `apps/server/src/auth/oauth.service.ts`
- **cleanDisplayName()** (2 connections) — `apps/server/src/auth/oauth.service.ts`
- **hasControlChar()** (2 connections) — `apps/server/src/auth/oauth.service.ts`
- **isDuplicateKey()** (2 connections) — `apps/server/src/auth/oauth.service.ts`
- **CallbackResult** (1 connections) — `apps/server/src/auth/oauth.service.ts`

## Relationships

- [Auth Service](Auth_Service.md) (17 shared connections)
- [Server App Bootstrap](Server_App_Bootstrap.md) (6 shared connections)
- [OAuth HTTP Client](OAuth_HTTP_Client.md) (4 shared connections)
- [Auth Schemas](Auth_Schemas.md) (3 shared connections)
- [Auth Controller Endpoints](Auth_Controller_Endpoints.md) (3 shared connections)
- [Auth Provider Config](Auth_Provider_Config.md) (2 shared connections)
- [Session Repo & Logout](Session_Repo_%26_Logout.md) (2 shared connections)

## Source Files

- `apps/server/src/auth/auth-config.ts`
- `apps/server/src/auth/oauth.service.ts`
- `apps/server/src/auth/user.repo.ts`

## Audit Trail

- EXTRACTED: 91 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*