# Custom maps: support double ferries

**Date:** 2026-07-07
**Status:** Approved

## Goal

Allow a custom map's double-route pair (`doubleGroup`) to include ferry routes (`ferryLocos > 0`),
and make the map builder able to author that combination. Today the engine and validation already
allow it structurally, but the builder actively blocks it and — if the block were simply removed —
would mint an invalid sibling route.

## Background: what already works

`doubleGroup` (parallel-route pairing/locking, `packages/engine/src/board.ts`'s `siblingOf`) and
`ferryLocos` (locomotive requirement, `packages/engine/src/payments.ts`'s `canAffordRoute`) are
independent per-route fields everywhere except the bundled Taiwan map's own authoring convention
(`packages/map-data/src/routes.ts`: "A route is at most one of {double, tunnel, ferry} on this
map."). Confirmed independent in:

- `@trm/engine`: `claimPreconditions`/`applyClaimEffects` (sibling lock) and `canAffordRoute` (ferry
  payment) never inspect each other's field.
- `@trm/map-data`'s `validateContent`: per-route ferry checks (`ferryMustBeGray`,
  `ferryLocosExceedLength`, `ferryAndTunnel`) and per-group double checks (`doubleGroupWrongCount`,
  `doubleGroupDifferentPairs`, `doubleGroupLengthMismatch`) run independently; nothing forbids a
  route from matching both.
- Server: `apps/server/src/maps/maps.schemas.ts`'s Zod schema has no cross-field refinement.
- Rendering: `apps/web/src/components/RouteShape.tsx` and `apps/server/src/og/map-svg.ts` take
  `isTunnel`/`isFerry`/`ferryLocos` as independent props; the double-pair parallel offset is computed
  separately by geometry code keyed on `doubleGroup`, oblivious to color/ferry status.

So **no engine, validation, schema, or rendering changes are needed.** The only real gap is the
builder's authoring flow, per `docs/superpowers/specs/2026-07-05-convert-route-to-double-design.md`,
which explicitly excluded ferries from "convert to double" as a deliberate scope decision at the
time — this design reverses that exclusion for ferries specifically (tunnels remain excluded,
unchanged).

## Decisions (settled with the user)

**Sibling default: mirror the ferry.** When the source route being doubled is a ferry, the sibling
defaults to the same GRAY color and the same `ferryLocos` count — a true double-ferry pair out of the
box — rather than defaulting to a plain colored route. The user can still edit either side
afterward (including dropping one side's `ferryLocos` to 0 to produce a mixed pair, one ferry + one
plain).

## 1. Store fix (`apps/web/src/features/builder/editor/store.ts`)

`convertToDouble(id)`:

- Drop the `target.ferryLocos > 0` guard from the eligibility check. Keep the `target.isTunnel` and
  `target.doubleGroup` guards unchanged (still no-ops).
- Sibling construction currently always flips color: `color: target.color === 'RED' ? 'BLUE' :
  'RED'`. Change so a ferry source is mirrored instead of flipped:
  ```
  color: target.ferryLocos > 0 ? target.color : (target.color === 'RED' ? 'BLUE' : 'RED')
  ```
  Since a ferry's `color` is always `'GRAY'` (enforced by the builder form and `validateContent`),
  this keeps the sibling GRAY. `ferryLocos` and `isTunnel` are already carried through unchanged via
  the existing `...target` spread — no change needed there.

## 2. UI fix (`RoutesStage.tsx`)

Two spots have the identical color-flip bug and eligibility gate:

- **New-route submit path** (`draftPair` branch, sibling created when `makeDouble` is checked):
  apply the same mirror-vs-flip fix to the inline `color: route.color === 'RED' ? 'BLUE' : 'RED'`
  expression, keyed on `route.ferryLocos > 0` the same way as the store fix. This is the path that
  lets a user check both "ferry locomotives" and "make this a double route" on a brand-new route in
  one step.
- **Convert-to-double button visibility** (`selectedRoute` branch's `extra` gate): change
  ```
  !selectedRoute.doubleGroup && !selectedRoute.isTunnel && selectedRoute.ferryLocos === 0
  ```
  to drop the `ferryLocos === 0` clause:
  ```
  !selectedRoute.doubleGroup && !selectedRoute.isTunnel
  ```

No other UI change: once a pair exists (via either path), each side's `RouteForm` already lets the
user edit `ferryLocos`/color/length independently of `doubleGroup` — that was never gated.

## 3. No changes needed elsewhere

- i18n: existing `makeDouble`/`convertToDouble`/`ferryLocos` strings already describe the actions
  generically; no new copy needed for the combined state.
- `CurvesStage.tsx`'s "double pairs always bow together" logic keys off `doubleGroup` only — unaffected.
- `ValidationPanel`/`validateContent` — already covers the combination (see Background).

## 4. Testing

- **`store.test.ts`:** update the existing "convertToDouble is a no-op for tunnel, ferry, or
  already-double routes" case — ferry is no longer a no-op; split it so only tunnel and
  already-double remain no-ops. Add a new case: converting a ferry route (`ferryLocos: 2, color:
  'GRAY'`) produces a sibling with the same `ferryLocos` and `color: 'GRAY'` (not a RED/BLUE flip).
- **`RoutesStage.test.tsx`:** add a case exercising the new-route path with both `ferryLocos` set and
  `makeDouble` checked, asserting the sibling mirrors ferry/color; add/update a case asserting the
  convert-to-double button now renders for a selected ferry route (still hidden for a tunnel).
- **`@trm/map-data` `content.spec.ts`:** add cases confirming `validateContent` accepts (a) a
  double-route pair where both members are ferries, and (b) a mixed pair (one ferry, one plain) —
  documenting that these already-permitted shapes are exercised, not just theoretically allowed.
- **`@trm/engine`:** add a regression test (alongside the existing named ferry/double-route hard-flow
  tests per the engine's CLAUDE.md convention) constructing a small board with a double-ferry pair,
  asserting: claiming one side locks the sibling under `SINGLE_ONLY` variant exactly like a
  non-ferry double route; payment validation still requires the right locomotive count on each side
  independently.

## 5. Documentation

Add a one-line clarification to `packages/map-data/CLAUDE.md`'s route-flags bullet, noting that
`doubleGroup` and `ferryLocos` may combine on custom maps even though the bundled Taiwan map's own
convention keeps them mutually exclusive.

## Out of scope

- Tunnel + double combinations — untouched, still excluded per the original convert-to-double design.
- Any change to the RED/BLUE alternation heuristic for non-ferry routes.
- Engine/schema/rendering changes — none needed, per Background.
