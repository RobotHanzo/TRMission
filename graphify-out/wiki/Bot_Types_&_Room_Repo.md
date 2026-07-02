# Bot Types & Room Repo

> 19 nodes · cohesion 0.16

## Key Concepts

- **lobby.service.ts** (30 connections) — `apps/server/src/lobby/lobby.service.ts`
- **room.repo.ts** (19 connections) — `apps/server/src/lobby/room.repo.ts`
- **types.ts** (12 connections) — `apps/server/src/bots/types.ts`
- **BotDifficulty** (8 connections) — `apps/server/src/bots/types.ts`
- **RoomView** (4 connections) — `apps/server/src/lobby/lobby.service.ts`
- **RoomMember** (4 connections) — `apps/server/src/lobby/room.repo.ts`
- **RoomSettings** (3 connections) — `apps/server/src/lobby/room.repo.ts`
- **RoomSettingsPatch** (3 connections) — `apps/server/src/lobby/room.repo.ts`
- **DEFAULT_ROOM_SETTINGS** (2 connections) — `apps/server/src/lobby/room.repo.ts`
- **BOT_DIFFICULTIES** (1 connections) — `apps/server/src/bots/types.ts`
- **isBotId()** (1 connections) — `apps/server/src/bots/types.ts`
- **TicketResult** (1 connections) — `apps/server/src/lobby/lobby.service.ts`
- **AddBotResult** (1 connections) — `apps/server/src/lobby/room.repo.ts`
- **JoinResult** (1 connections) — `apps/server/src/lobby/room.repo.ts`
- **KickResult** (1 connections) — `apps/server/src/lobby/room.repo.ts`
- **RemoveBotResult** (1 connections) — `apps/server/src/lobby/room.repo.ts`
- **RoomStatus** (1 connections) — `apps/server/src/lobby/room.repo.ts`
- **RoomVisibility** (1 connections) — `apps/server/src/lobby/room.repo.ts`
- **UpdateSettingsResult** (1 connections) — `apps/server/src/lobby/room.repo.ts`

## Relationships

- [Lobby Management](Lobby_Management.md) (14 shared connections)
- [WebSocket Hub](WebSocket_Hub.md) (5 shared connections)
- [Server App Bootstrap](Server_App_Bootstrap.md) (4 shared connections)
- [Game Session & Persistence](Game_Session_%26_Persistence.md) (3 shared connections)
- [Server E2E Tests](Server_E2E_Tests.md) (3 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (3 shared connections)
- [Bot AI Policy](Bot_AI_Policy.md) (2 shared connections)
- [History & SDD Docs](History_%26_SDD_Docs.md) (1 shared connections)
- [Auth Service](Auth_Service.md) (1 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (1 shared connections)
- [Engine State/View Types](Engine_State-View_Types.md) (1 shared connections)
- [Board & Legal Actions](Board_%26_Legal_Actions.md) (1 shared connections)

## Source Files

- `apps/server/src/bots/types.ts`
- `apps/server/src/lobby/lobby.service.ts`
- `apps/server/src/lobby/room.repo.ts`

## Audit Trail

- EXTRACTED: 95 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*