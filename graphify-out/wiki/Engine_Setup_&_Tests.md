# Engine Setup & Tests

> 41 nodes · cohesion 0.11

## Key Concepts

- **initGame()** (35 connections) — `packages/engine/src/setup.ts`
- **setup.ts** (31 connections) — `packages/engine/src/setup.ts`
- **reduce()** (30 connections) — `packages/engine/src/reduce.ts`
- **forcedTicketDraw.spec.ts** (29 connections) — `packages/engine/test/forcedTicketDraw.spec.ts`
- **serialize.ts** (28 connections) — `packages/engine/src/serialize.ts`
- **useReplayPlayer.test.ts** (27 connections) — `apps/web/src/features/replay/useReplayPlayer.test.ts`
- **instant-completion.spec.ts** (27 connections) — `packages/engine/test/instant-completion.spec.ts`
- **scenarios.test.ts** (25 connections) — `apps/web/src/features/tutorial/scenarios.test.ts`
- **draw-rainbow.spec.ts** (19 connections) — `packages/engine/test/draw-rainbow.spec.ts`
- **config.ts** (18 connections) — `packages/engine/src/config.ts`
- **redact.spec.ts** (17 connections) — `packages/engine/test/redact.spec.ts`
- **Lesson** (11 connections) — `apps/web/src/features/tutorial/types.ts`
- **cloneState()** (10 connections) — `packages/engine/src/serialize.ts`
- **engine.spec.ts** (10 connections) — `packages/engine/test/engine.spec.ts`
- **playGreedyGame()** (10 connections) — `packages/engine/test/helpers.ts`
- **replay()** (9 connections) — `packages/engine/src/serialize.ts`
- **.constructor()** (8 connections) — `apps/web/src/net/sandboxSocket.ts`
- **makeConfig()** (8 connections) — `packages/engine/test/helpers.ts`
- **runLesson()** (6 connections) — `apps/web/src/features/tutorial/scenarios.test.ts`
- **scriptActions()** (5 connections) — `apps/web/src/features/replay/useReplayPlayer.test.ts`
- **.history()** (4 connections) — `apps/server/src/game/game-session.ts`
- **buildDeck()** (4 connections) — `packages/engine/src/deck.ts`
- **toAwait()** (4 connections) — `packages/engine/test/draw-rainbow.spec.ts`
- **afterSetup()** (4 connections) — `packages/engine/test/redact.spec.ts`
- **apply()** (3 connections) — `packages/engine/test/rules.spec.ts`
- _... and 16 more nodes in this community_

## Relationships

- [Board & Legal Actions](Board_%26_Legal_Actions.md) (48 shared connections)
- [Game Session & Persistence](Game_Session_%26_Persistence.md) (32 shared connections)
- [Core Reducer & Payments](Core_Reducer_%26_Payments.md) (25 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (24 shared connections)
- [Engine State/View Types](Engine_State-View_Types.md) (24 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (18 shared connections)
- [Wire Codec](Wire_Codec.md) (14 shared connections)
- [Tutorial System](Tutorial_System.md) (11 shared connections)
- [Server E2E Tests](Server_E2E_Tests.md) (10 shared connections)
- [Seeded RNG](Seeded_RNG.md) (6 shared connections)
- [Action Log](Action_Log.md) (3 shared connections)
- [Sandbox Socket](Sandbox_Socket.md) (3 shared connections)

## Source Files

- `apps/server/src/game/game-session.ts`
- `apps/server/vitest.config.ts`
- `apps/web/src/features/replay/useReplayPlayer.test.ts`
- `apps/web/src/features/tutorial/scenarios.test.ts`
- `apps/web/src/features/tutorial/types.ts`
- `apps/web/src/net/sandboxSocket.ts`
- `apps/web/vite.config.ts`
- `packages/engine/src/config.ts`
- `packages/engine/src/deck.ts`
- `packages/engine/src/reduce.ts`
- `packages/engine/src/serialize.ts`
- `packages/engine/src/setup.ts`
- `packages/engine/test/draw-rainbow.spec.ts`
- `packages/engine/test/engine.spec.ts`
- `packages/engine/test/forcedTicketDraw.spec.ts`
- `packages/engine/test/helpers.ts`
- `packages/engine/test/instant-completion.spec.ts`
- `packages/engine/test/redact.spec.ts`
- `packages/engine/test/rules.spec.ts`

## Audit Trail

- EXTRACTED: 400 (99%)
- INFERRED: 3 (1%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
