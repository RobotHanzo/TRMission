# Map Builder — Antimeridian-aware Cropping Design

**Date:** 2026-07-11
**Area:** `apps/web/src/features/builder/` (client-only; no server/proto/engine changes)

## Problem

Countries whose land crosses the ±180° antimeridian — **Russia** and **Fiji** in the bundled
Natural Earth 1:110m dataset — are stored with longitudes spanning nearly the full −180°…+180°
range. When such a country is selected in the map builder's "pick countries" mode, or would be
covered by a crop, the union bounding box computed by `boundsOfRings` is ~359° wide. The
equirectangular projection then stretches that near-global span across the board, rendering the
country as **two thin slivers hugging the left and right edges with empty ocean between** —
"cut off" and not in one piece.

Verified extents (from `geo/worldCountries.ts`):

- **RUS**: lon −179.88° … +179.49° → raw span 359° (26 far-west negative-lon points near −180°).
- **FJI**: lon −180° … +180° → raw span ~358°.

No other country in the dataset crosses the seam (USA's Aleutians are clamped under 180° span in
1:110m). Antarctica is excluded from the dataset entirely.

## Goal

1. **Country-pick**: selecting Russia, Fiji (or any future crosser) builds the map with the
   country as one contiguous landmass — automatically, no UI change.
2. **Crop-draw**: the manual crop rectangle can straddle the antimeridian, via a **panorama**
   world map the user pans across the seam to draw a normal rectangle over it.

Both share a single geometry primitive; they differ only in how the crop that crosses the seam is
_expressed_ (auto-detected vs. drawn).

## The core idea: longitude unwrapping

Represent a seam-crossing region contiguously by shifting its western (negative-longitude) points
by +360°, so a crop bounding box may legitimately have `lonMax > 180` (e.g. Russia becomes
19°…191° instead of −180°…+180°). Everything downstream already tolerates this:

- `buildProjection` (`geo/projection.ts`) projects off `lon − crop.lonMin`, so a `lonMax` above
  180 just widens the span it normalizes into board space. `cos(midLat)` depends on latitude only.
- `isValidCrop` only checks finiteness, `lonMin < lonMax`, and latitude bounds (−84…84) — it does
  **not** require longitudes within ±180.
- `@trm/map-data`'s `validateGeographyIssues` (`validate.ts:356`) only requires
  `crop.lonMin < crop.lonMax`; the projected `land` is normalized to board units (~0…92) regardless
  of raw longitude, so the `≤150` coordinate-range check is unaffected.
- `hashContent` folds `geography` (including `crop`) in deterministically; wrapped numeric bounds
  hash cleanly, and the 2 dp rounding that guarantees stable re-publish hashes is unchanged.

## New module: `geo/antimeridian.ts`

Small, pure, independently testable. Exports:

```ts
import type { Ring } from './clip';
import type { CropBBox } from './projection';

/** Longitude span of a bbox. */
export function lonSpan(bbox: CropBBox): number;

/** Copy of `rings` with every point translated in longitude by `delta` (e.g. +360 or -360). */
export function shiftLon(rings: readonly Ring[], delta: number): Ring[];

/** Copy of `rings` with every point whose lon < 0 shifted by +360° (conditional, per-point —
 *  NOT `shiftLon(rings, 360)`, which would move every point). */
export function unwrapEast(rings: readonly Ring[]): Ring[];

/** Bounding box of a set of rings, or null for empty input.
 *  (Moved here from world.ts's private `boundsOfRings`, re-exported for reuse.) */
export function boundsOfRings(rings: readonly Ring[]): CropBBox | null;

/** Pick whichever of {raw rings, east-unwrapped rings} has the smaller longitude span —
 *  i.e. only unwrap when it makes the selection MORE contiguous. Returns the chosen rings and
 *  their bbox. Null for empty input. */
export function chooseMinimalLonRepresentation(
  rings: readonly Ring[],
): { rings: readonly Ring[]; bbox: CropBBox } | null;
```

`chooseMinimalLonRepresentation` is the robust detector. It never unwraps a selection that is
genuinely wide but non-crossing (e.g. France's entry includes a French Guiana ring at −54°, giving
a 63° raw span; east-unwrapping would balloon it to 297°, so raw is kept). It only unwraps when the
result is strictly narrower — which is exactly the antimeridian case (RUS 359°→172°, FJI 358°→5°).

## Path 1 — Country-pick (`geo/world.ts`, automatic)

`countriesToGeography(ids)` currently:

```ts
const rings = WORLD_COUNTRIES.filter((c) => idSet.has(c.id)).flatMap(ringsForCountry);
const bbox = boundsOfRings(rings);
if (!bbox || !isValidCrop(bbox)) return null;
return finalizeGeography(dissolveCountryRings(rings), bbox);
```

Changes to:

```ts
const rings = WORLD_COUNTRIES.filter((c) => idSet.has(c.id)).flatMap(ringsForCountry);
const chosen = chooseMinimalLonRepresentation(rings);
if (!chosen || !isValidCrop(chosen.bbox)) return null;
return finalizeGeography(dissolveCountryRings(chosen.rings), chosen.bbox);
```

- `boundsOfRings` moves to `geo/antimeridian.ts` (world.ts imports it from there; behavior
  identical for existing callers).
- `dissolveCountryRings` (polygon union) operates on the already-unwrapped coordinate space, so the
  union is computed where the country is contiguous — no code change to the dissolve itself.
- No UI change. `CountryPickStage.tsx`'s selection map (viewBox −180…180) still draws each country
  from raw rings and remains fully clickable; only the _result geometry_ changes.

Result: RUS and FJI dissolve and project as one landmass; every other selection is byte-identical
to before (the smaller-span branch is always the raw one for non-crossers).

## Path 2 — Crop-draw panorama

### `CropDrawStage.tsx`

Turn the fixed −180…180 world into a horizontally repeating panorama:

- **viewBox** `-540 -90 1080 180` (three world widths).
- Render **sea + graticule + land three times**, at longitude offsets `[-360, 0, +360]`. Land is
  `worldLand()` rings drawn with `x = lon + offset`. The sea rect and graticule lines are drawn per
  offset too so the panorama reads seamlessly.
- **`TransformWrapper`** config:
  - `initialScale={3}` + `centerOnInit` → the initial view shows exactly one world, centered —
    **visually identical to today**.
  - `minScale={3}` → can't zoom out past one world (no showing the triple panorama at once).
  - `maxScale={192}` → preserves today's effective 64× zoom-in on a one-world basis
    (64 × 3 = 192).
  - `limitToBounds` on (default) → pan is bounded to the 3-world content: a full extra world on
    each side, enough for any single seam-crossing crop.
  - Panning unchanged: `allowLeftClickPan: false`, `allowMiddleClickPan: true`; left-click draws.
- **`toLonLat`** now returns `x ∈ [−540, 540]`; a drag into a neighbor copy yields `lon > 180` (or
  `< −180`). The live drag rect and handles render correctly because the viewBox spans all three
  copies.
- **Commit normalization** (new helper, e.g. `normalizeCropLon(rect)`): reduce so
  `lonMin ∈ [−180, 180)` and `lonMax = lonMin + span`; if the drawn `span ≥ 360`, clamp to a valid
  crop (treat as invalid → no result, same as today's degenerate rects). Latitude handling
  unchanged. This runs in `onSvgPointerUp` (freehand) and in the committed-rect derivations so a
  stored crop is always canonical.
- **Re-opening a saved wrap crop**: `committed` is seeded from `draft.geography.crop`, which may
  have `lonMax > 180`. `centerOnInit` opens on world 0; a crop near the seam sits at the right edge
  of world 0 / left of world +1 and is visible. (Auto-centering precisely on the saved crop is a
  possible refinement, not required for v1.)

### `geo/world.ts` — `cropToGeography`

```ts
export function cropToGeography(crop: CropBBox): CropResult | null {
  if (!isValidCrop(crop)) return null;
  const clipped = clipWrapped(WORLD_LAND_DETAILED, crop);
  return finalizeGeography(clipped, crop);
}
```

`clipWrapped(rings, crop)`:

- If `crop.lonMax <= 180` and `crop.lonMin >= -180`: `clipRingsToBBox(rings, crop)` (unchanged
  path — no behavior change for every existing, non-wrapping crop).
- Otherwise: clip the land **at native offset and at the shifted offset** that the crop window
  reaches into, then concatenate survivors:
  - `lonMax > 180`: `clipRingsToBBox(rings, crop)` ∪ `clipRingsToBBox(shiftLon(rings, +360), crop)`.
  - (Symmetric `-360` branch if `lonMin < -180`; normalization keeps `lonMin ≥ -180`, so this is a
    guard, not a routine path.)
- The Natural Earth source already splits antimeridian features into separate per-side rings, so
  no single ring is torn by the shift; each survives in exactly one offset copy, and Sutherland–
  Hodgman clips away everything outside the crop window.

`shiftLon(rings, delta)` lives in `geo/antimeridian.ts` alongside `unwrapEast` (which is the
`delta = +360, only-if-negative` special case).

### `isValidCrop` (`geo/projection.ts`)

Add a longitude-span guard so a degenerate near-global or over-wrapped crop is rejected:

```ts
crop.lonMax - crop.lonMin < 360;
```

(Latitude bounds and `lonMin < lonMax` unchanged. A normal −179…179 crop, span 358, still passes.)

## Determinism & non-regression

- All new geometry is pure integer/float longitude arithmetic plus the existing 2 dp rounding — no
  `Date`, no randomness. Re-publishing an untouched wrapped-crop draft reproduces the same
  `contentHash`.
- Every non-crossing country selection and every non-wrapping crop takes the unchanged code branch
  and produces byte-identical output. This is asserted by keeping the existing `world.test.ts`
  cases green.

## Testing

**`geo/antimeridian.test.ts`** (new)

- `unwrapEast` shifts only negative-lon points by +360, leaves positives untouched.
- `chooseMinimalLonRepresentation`:
  - A Russia-like ring set (points near +179 and −179) → returns the unwrapped rings, bbox span
    < 180.
  - A France+Guiana-like set (8° and −54°, no seam crossing) → returns the raw rings unchanged.
  - Empty input → null.
- `lonSpan`, `boundsOfRings`, `shiftLon` basic correctness.

**`geo/world.test.ts`** (extend)

- `countriesToGeography(['RUS'])`: result non-null; `geography.crop` span is the small unwrapped
  value (< 200), not ~359; the largest land ring is a single contiguous cluster (assert its
  projected x-extent is not two groups pinned to opposite board edges); `validateGeography` clean.
- `countriesToGeography(['FJI'])`: same shape of assertions.
- All existing `countriesToGeography` / `cropToGeography` cases stay green (non-regression).
- `cropToGeography({ lonMin: 160, lonMax: 200, latMin: 50, latMax: 72 })`: returns land drawn from
  **both** sides of the seam (compare land ring count / extent against the same-width non-wrapping
  crop at `lonMin: 140, lonMax: 180` to prove the +360 copy contributed).

**`editor/stages/CropDrawStage.test.tsx`** (extend)

- Renders three land copies (offset repetition present in the DOM).
- The `normalizeCropLon` helper is unit-tested directly (canonicalizes `lonMin` into `[−180, 180)`,
  rejects span ≥ 360) — because full drag-across-seam can't be simulated in jsdom (`getScreenCTM`
  returns null there, the reason `clientToBoardPoint` guards it).

## Out of scope

- Changing `CountryPickStage.tsx`'s selection map so Russia looks whole while _browsing_ to click
  it (cosmetic; it's already one clickable path). Optional future polish.
- Auto-centering the crop panorama precisely on a re-opened wrapped crop.
- Any server, proto, engine, or `@trm/map-data` change.

## Files

- **New**: `apps/web/src/features/builder/geo/antimeridian.ts` + `antimeridian.test.ts`.
- **Modify**: `geo/world.ts` (`countriesToGeography`, `cropToGeography`, move `boundsOfRings` out),
  `geo/projection.ts` (`isValidCrop` span guard),
  `editor/stages/CropDrawStage.tsx` (panorama render + config + `normalizeCropLon`).
- **Extend tests**: `geo/world.test.ts`, `editor/stages/CropDrawStage.test.tsx`.
