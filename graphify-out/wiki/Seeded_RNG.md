# Seeded RNG

> 12 nodes · cohesion 0.33

## Key Concepts

- **makeRng()** (11 connections) — `packages/shared/src/rng.ts`
- **nextInt()** (11 connections) — `packages/shared/src/rng.ts`
- **rng.ts** (10 connections) — `packages/shared/src/rng.ts`
- **shuffle()** (8 connections) — `packages/shared/src/rng.ts`
- **rng.spec.ts** (7 connections) — `packages/shared/test/rng.spec.ts`
- **roomCode.ts** (5 connections) — `packages/shared/src/roomCode.ts`
- **st()** (4 connections) — `packages/engine/test/rules.spec.ts`
- **nextU32()** (4 connections) — `packages/shared/src/rng.ts`
- **hashSeed()** (3 connections) — `packages/shared/src/rng.ts`
- **mix32()** (2 connections) — `packages/shared/src/rng.ts`
- **generateRoomCode()** (2 connections) — `packages/shared/src/roomCode.ts`
- **EXPECTED** (1 connections) — `packages/shared/test/rng.spec.ts`

## Relationships

- [Board & Legal Actions](Board_%26_Legal_Actions.md) (8 shared connections)
- [Engine Setup & Tests](Engine_Setup_%26_Tests.md) (6 shared connections)
- [Core Reducer & Payments](Core_Reducer_%26_Payments.md) (5 shared connections)
- [Engine State/View Types](Engine_State-View_Types.md) (2 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (2 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (1 shared connections)

## Source Files

- `packages/engine/test/rules.spec.ts`
- `packages/shared/src/rng.ts`
- `packages/shared/src/roomCode.ts`
- `packages/shared/test/rng.spec.ts`

## Audit Trail

- EXTRACTED: 68 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
