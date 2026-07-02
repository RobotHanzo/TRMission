# Session State Actions

> 12 nodes · cohesion 0.17

## Key Concepts

- **SessionState** (10 connections) — `apps/web/src/store/session.ts`
- **UserPreferences** (6 connections) — `apps/web/src/net/rest.ts`
- **PublicUser** (3 connections) — `apps/web/src/net/rest.ts`
- **.savePreferences()** (2 connections) — `apps/web/src/store/session.ts`
- **.applyPreferences()** (2 connections) — `apps/web/src/store/ui.ts`
- **.clearError()** (1 connections) — `apps/web/src/store/session.ts`
- **.login()** (1 connections) — `apps/web/src/store/session.ts`
- **.logout()** (1 connections) — `apps/web/src/store/session.ts`
- **.playAsGuest()** (1 connections) — `apps/web/src/store/session.ts`
- **.register()** (1 connections) — `apps/web/src/store/session.ts`
- **.restore()** (1 connections) — `apps/web/src/store/session.ts`
- **.upgrade()** (1 connections) — `apps/web/src/store/session.ts`

## Relationships

- [REST Client & Auth Screens](REST_Client_%26_Auth_Screens.md) (5 shared connections)
- [Settings & UI State](Settings_%26_UI_State.md) (2 shared connections)
- [URL Routing & Connection](URL_Routing_%26_Connection.md) (1 shared connections)

## Source Files

- `apps/web/src/net/rest.ts`
- `apps/web/src/store/session.ts`
- `apps/web/src/store/ui.ts`

## Audit Trail

- EXTRACTED: 30 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*