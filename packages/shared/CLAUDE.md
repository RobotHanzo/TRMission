# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@trm/shared` is the cross-cutting foundation imported by every other package. It owns the things
that must be defined exactly once so they cannot drift across the engine, the wire, the DB, and the
UI. Commands: `yarn workspace @trm/shared test` / `… typecheck` / `… lint`.

## What lives here (and why it must live here)

- `rng.ts` — the **seeded integer counter PRNG** (`splitmix32` over a `{seed, counter}:uint32`
  state). This is the _only_ sanctioned source of randomness for the engine; it must produce
  byte-identical sequences in Node and browser V8 (there is a checked-in conformance expectation).
  Do not replace it with `Math.random` or a float-based PRNG anywhere downstream.
- `digest.ts` — the canonical **key-sorted SHA-256** digest used for `stateDigest` (replay/divergence
  detection) and for `CONTENT_HASH`. Determinism of this function is load-bearing; key ordering must
  stay stable.
- `enums.ts` / `constants.ts` — `CardColor`/`TrainColor` (8 colours + `LOCOMOTIVE`; the 6th is
  **PURPLE**, never PINK), the `Hand` multiset type, `RuleParams` (the resolved per-game tuning incl.
  `routePoints` score table), and `DEFAULT_RULE_PARAMS`. `CARD_COLORS`/`TRAIN_COLORS` array order is
  frozen because the engine iterates it for deterministic shuffles.
- `errors.ts` — the **single error taxonomy** (`RuleViolationCode` → `messageKeyFor`). This is one
  end of a 1:1 mapping that continues into proto `RejectionCode` and the i18n keys; keep the four in
  sync (engine code → proto code → REST `error.code` → i18n `messageKey`).
- `ids.ts` — branded id types (`PlayerId`, `RouteId`, `CityId`, `TicketId`, `SeatIndex`) + `asPlayerId`
  etc. Branding is what keeps raw strings from being passed where a typed id is expected.
- `roomCode.ts` — room-code alphabet/generation (no easily-confused glyphs).

## Conventions

ESM, strict TS (`verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
Adding an enum value or rule param almost always means touching the proto schema and the codec too —
search for the existing member across `packages/proto` and `apps/server/src/codec` before adding.
