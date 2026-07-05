# Claim-cost specimen — design

## Goal

The `claim.intro` tutorial beat narrates the route-claiming rule:

> 宣告路線時，支付與路線「等長、同一種顏色」的火車牌（火車頭可當任意顏色）；灰色路線可用任一種顏色支付。每段路線各花一個火車車廂。

It currently renders **no specimen**. Add a graphic — in the existing coachmark visual-glossary
style — that shows railways of **varying length each pointing to the cards that pay for it**, so the
learner sees "length = card count, one colour" before the demo claim.

## Where it plugs in

The tutorial coachmark renders an optional `SpecimenSpec` beside each beat (`TutorialOverlay` →
`Specimen` switch in `apps/web/src/features/tutorial/Specimens.tsx`). We add a new variant and attach
it to the `claim.intro` beat in `curriculum.ts`. No new wiring mechanism — this is one more specimen
kind alongside `route`, `card-row`, `station-cost`, `score-table`, etc.

## The graphic

Three rows, each `[ track of length N ]  →  [ one card with ×N ]`, in the payment-modal idiom (one
card carrying a `×N` count chip, **not** N separate cards):

```
red route, length 2    ━━        →   [🟥 card  ×2]     static, matching colour
blue route, length 4   ━━━━      →   [🟦 card  ×4]     static, matching colour
gray route, length 3   ━━━       →   [↻ card   ×3]     colour-CYCLING (any colour)
```

### Row anatomy

- **Track (left):** a mini horizontal route of length _N_ drawn with the live board classes
  (`route` / `bed` / `slot`), reusing the geometry of `RouteSpecimen`'s `Track` but with a
  parametrised slot count and fill colour, so it can never drift from the board's look.
- **Arrow:** a small `→` connector between the track and the card.
- **Card (right):** one `TrainCarCard` with `count={N}` — the `×N` chip + stacked-deck shadow,
  identical to `PaymentModal`'s spend options.

### How the colour contrast teaches the rule

- **Colored rows** (red length 2, blue length 4): a **static** `TrainCarCard` of the colour that
  matches the route. Teaches "equal length, **same colour as the route**." Locomotive-as-wild is left
  to the narration text (already covered) — not drawn here, to keep the graphic focused.
- **Gray row** (length 3): the **animated cross-fade** card — the same mechanism the station chapter
  uses (`CyclingCard` in `StationCostSpecimen`) — cycling through the palette to express "gray route =
  **any single colour**." Carries a `×3` chip like the other rows.

This mirrors the user-confirmed decision: colored rows static, gray row animated.

## Implementation surface

All in `apps/web`:

1. **`features/tutorial/types.ts`** — add `| { kind: 'claim-cost' }` to the `SpecimenSpec` union.
2. **`features/tutorial/Specimens.tsx`**
   - Generalise the track render: a small `length`-and-`fill` parametrised track helper (factored from
     `RouteSpecimen`'s `Track`, or a focused local helper for the claim rows) so a row can draw a
     length-2 / length-4 / length-3 track.
   - Extend `CyclingCard` to accept an optional `count`, passed to the inner `TrainCarCard` on **both**
     stacked layers (so the `×N` chip cross-fades with the colour and the footprint stays stable).
   - Add `ClaimCostSpecimen`: three rows as above. Colored rows use a static `TrainCarCard`
     `color`/`count`; the gray row uses the (now count-aware) cycling card. Reuses the same
     `idx`-on-an-interval + `useReducedMotion` pattern as `StationCostSpecimen` for the cross-fade.
   - Add `case 'claim-cost': return <ClaimCostSpecimen />;` to the `Specimen` switch.
3. **`features/tutorial/curriculum.ts`** — add `specimen: { kind: 'claim-cost' }` to the `claim.intro`
   beat (the only change to the `claim` lesson).
4. **`styles/tutorial.css`** — `tut-claim-cost*` classes: the row grid (`[track] → [card]`), the arrow,
   spacing. Follow the existing `tut-cost-*` / `tut-route-compare` conventions; honour
   `prefers-reduced-motion` (already handled for the cycling layers).
5. **Tests** — extend `features/tutorial/Specimens.test.tsx` with a `claim-cost` render case asserting
   the specimen mounts (`data-testid="tut-specimen"`) and shows the three rows / `×2`, `×4`, `×3`
   chips. No engine/scenario changes needed (this beat is `mode: 'info'`).

## Constants

- Rows: `[{ color: 'RED', len: 2 }, { color: 'BLUE', len: 4 }, { kind: 'gray', len: 3 }]`.
- Cross-fade interval and reduced-motion handling: reuse `StationCostSpecimen`'s values (1500ms
  interval; animation disabled under `prefers-reduced-motion`).

## Out of scope

- No change to the rule text, the demo claim (`claim.demo` → R16), or any engine/scoring logic.
- No locomotive/wild card drawn in this specimen (covered by narration and the `loco`/`card-row`
  specimens elsewhere).
- No i18n string strictly required — the graphic is self-describing; the railway is its own label. (If
  a caption reads better in review, add a single `tutorial.glossary.any` key, but the default is no
  text.)

## Success criteria

- The `claim.intro` coachmark shows three railways of length 2 / 4 / 3 pointing to a single card each,
  with `×2` / `×4` / `×3` chips.
- Red→red card, blue→blue card (static); gray→a card whose colour cycles (animated), still `×3`.
- Reuses live `TrainCarCard` and board route classes (no bespoke card/route art).
- Respects `prefers-reduced-motion` (no cross-fade animation).
- `yarn workspace @trm/web test` and `yarn lint` / `yarn typecheck` pass.
