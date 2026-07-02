# Socket Status & Game State

> 8 nodes · cohesion 0.29

## Key Concepts

- **GameState** (8 connections) — `apps/web/src/store/game.ts`
- **SocketStatus** (4 connections) — `apps/web/src/net/socket.ts`
- **.setStatus()** (2 connections) — `apps/web/src/store/game.ts`
- **.applyCameraMoved()** (1 connections) — `apps/web/src/store/game.ts`
- **.applyEvents()** (1 connections) — `apps/web/src/store/game.ts`
- **.applySnapshot()** (1 connections) — `apps/web/src/store/game.ts`
- **.reset()** (1 connections) — `apps/web/src/store/game.ts`
- **.setRejection()** (1 connections) — `apps/web/src/store/game.ts`

## Relationships

- [Chat & Game Store](Chat_%26_Game_Store.md) (2 shared connections)
- [Game Command Definitions](Game_Command_Definitions.md) (1 shared connections)

## Source Files

- `apps/web/src/net/socket.ts`
- `apps/web/src/store/game.ts`

## Audit Trail

- EXTRACTED: 19 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*