# Core Reducer & Payments

> 72 nodes · cohesion 0.09

## Key Concepts

- **reduce.ts** (87 connections) — `packages/engine/src/reduce.ts`
- **payments.ts** (22 connections) — `packages/engine/src/payments.ts`
- **deck.ts** (21 connections) — `packages/engine/src/deck.ts`
- **hand.ts** (19 connections) — `packages/engine/src/hand.ts`
- **emptyHand()** (17 connections) — `packages/shared/src/enums.ts`
- **violation()** (17 connections) — `packages/shared/src/errors.ts`
- **ok()** (17 connections) — `packages/shared/src/result.ts`
- **err()** (16 connections) — `packages/shared/src/result.ts`
- **dispatch()** (14 connections) — `packages/engine/src/reduce.ts`
- **applyClaimRoute()** (13 connections) — `packages/engine/src/reduce.ts`
- **endTurn()** (13 connections) — `packages/engine/src/turn.ts`
- **applyResolveTunnel()** (12 connections) — `packages/engine/src/reduce.ts`
- **drawOne** (11 connections) — `packages/engine/src/deck.ts`
- **applyBuildStation()** (11 connections) — `packages/engine/src/reduce.ts`
- **applyKeepTickets()** (11 connections) — `packages/engine/src/reduce.ts`
- **getPlayer()** (11 connections) — `packages/engine/src/reducers/common.ts`
- **RngState** (10 connections) — `packages/shared/src/rng.ts`
- **CardCounts** (9 connections) — `packages/engine/src/hand.ts`
- **applyKeepInitial()** (9 connections) — `packages/engine/src/reduce.ts`
- **hasAnyLegalMove()** (9 connections) — `packages/engine/src/reduce.ts`
- **lockCompletedTickets()** (9 connections) — `packages/engine/src/reduce.ts`
- **withPlayer()** (9 connections) — `packages/engine/src/reducers/common.ts`
- **refillMarket()** (8 connections) — `packages/engine/src/deck.ts`
- **validateRoutePayment()** (8 connections) — `packages/engine/src/payments.ts`
- **validateStationPayment()** (8 connections) — `packages/engine/src/payments.ts`
- *... and 47 more nodes in this community*

## Relationships

- [Board & Legal Actions](Board_%26_Legal_Actions.md) (30 shared connections)
- [Engine Setup & Tests](Engine_Setup_%26_Tests.md) (25 shared connections)
- [Engine State/View Types](Engine_State-View_Types.md) (23 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (14 shared connections)
- [Server App Bootstrap](Server_App_Bootstrap.md) (8 shared connections)
- [Game Session & Persistence](Game_Session_%26_Persistence.md) (5 shared connections)
- [Seeded RNG](Seeded_RNG.md) (5 shared connections)
- [Wire Codec](Wire_Codec.md) (5 shared connections)
- [Payment UI & Logic](Payment_UI_%26_Logic.md) (2 shared connections)
- [Map-Data Content Registry](Map-Data_Content_Registry.md) (2 shared connections)
- [Map Data Content](Map_Data_Content.md) (2 shared connections)
- [Shared Constants & Enums](Shared_Constants_%26_Enums.md) (2 shared connections)

## Source Files

- `packages/engine/src/board.ts`
- `packages/engine/src/config.ts`
- `packages/engine/src/deck.ts`
- `packages/engine/src/hand.ts`
- `packages/engine/src/payments.ts`
- `packages/engine/src/reduce.ts`
- `packages/engine/src/reducers/common.ts`
- `packages/engine/src/tickets.ts`
- `packages/engine/src/turn.ts`
- `packages/engine/test/forcedTicketDraw.spec.ts`
- `packages/engine/test/instant-completion.spec.ts`
- `packages/shared/src/enums.ts`
- `packages/shared/src/errors.ts`
- `packages/shared/src/result.ts`
- `packages/shared/src/rng.ts`

## Audit Trail

- EXTRACTED: 559 (100%)
- INFERRED: 1 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*