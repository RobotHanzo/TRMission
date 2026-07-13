# Antimeridian-aware Map Builder Cropping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the map builder render countries and crops that cross the ±180° antimeridian
(Russia, Fiji, or a hand-drawn Bering-Strait crop) as one contiguous landmass instead of two
edge-hugging slivers.

**Architecture:** A new pure module `geo/antimeridian.ts` holds all longitude-unwrap math. The
country-pick path auto-picks the narrower-span (unwrapped) representation of the selected rings.
The crop-draw stage becomes a 3-wide pannable "panorama" so a rectangle can be drawn across the
seam, and `cropToGeography` clips world land at native + ±360 offsets when the crop reaches past
±180. This is a **client-only** change under `apps/web/src/features/builder/` — no server, proto,
engine, or `@trm/map-data` changes.

**Tech Stack:** React + TypeScript, Vite ^5, vitest + @testing-library/react, react-zoom-pan-pinch,
`polygon-clipping`. Geometry helpers are plain TS.

## Global Constraints

- **Client-only.** Touch only files under `apps/web/src/features/builder/`. No server/proto/engine/
  `@trm/map-data` edits.
- **Determinism / hash stability.** No `Date`, `Math.random`, or unseeded randomness anywhere in the
  geometry pipeline. The existing 2 dp rounding in `projection.ts` (`round2`) is what keeps
  re-published drafts hashing identically — do not change rounding. Pure longitude arithmetic only.
- **Vite pinned at ^5** for vitest 2 compatibility — do not bump.
- **Non-regression is a hard requirement.** Every non-crossing country selection and every
  non-wrapping crop must take an unchanged code branch and produce byte-identical output. Keep all
  existing `geo/world.test.ts`, `geo/projection.test.ts`, and
  `editor/stages/CropDrawStage.test.tsx` cases green.
- Types: `Ring = readonly (readonly [number, number])[]` and `Point = readonly [number, number]`
  from `geo/clip.ts`; `CropBBox = { lonMin; lonMax; latMin; latMax }` from `geo/projection.ts`.

---

### Task 1: `geo/antimeridian.ts` — pure longitude-unwrap helpers

**Files:**

- Create: `apps/web/src/features/builder/geo/antimeridian.ts`
- Test: `apps/web/src/features/builder/geo/antimeridian.test.ts`

**Interfaces:**

- Consumes: `Ring`, `Point` from `./clip`; `CropBBox` from `./projection`.
- Produces (relied on by Tasks 2, 3, 5):
  - `lonSpan(bbox: CropBBox): number`
  - `shiftLon(rings: readonly Ring[], delta: number): Ring[]`
  - `unwrapEast(rings: readonly Ring[]): Ring[]`
  - `boundsOfRings(rings: readonly Ring[]): CropBBox | null`
  - `chooseMinimalLonRepresentation(rings: readonly Ring[]): { rings: readonly Ring[]; bbox: CropBBox } | null`
  - `normalizeCropLon(bbox: CropBBox): CropBBox`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/builder/geo/antimeridian.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  lonSpan,
  shiftLon,
  unwrapEast,
  boundsOfRings,
  chooseMinimalLonRepresentation,
  normalizeCropLon,
} from './antimeridian';
import type { Ring } from './clip';

describe('shiftLon', () => {
  it('translates every point in longitude, leaving latitude untouched', () => {
    const rings: Ring[] = [
      [
        [10, 5],
        [-10, -5],
      ],
    ];
    expect(shiftLon(rings, 360)).toEqual([
      [
        [370, 5],
        [350, -5],
      ],
    ]);
  });
});

describe('unwrapEast', () => {
  it('shifts only negative-lon points by +360 (stitches a seam-crossing ring)', () => {
    const rings: Ring[] = [
      [
        [179, 60],
        [-179, 60],
        [-170, 50],
        [170, 50],
      ],
    ];
    expect(unwrapEast(rings)).toEqual([
      [
        [179, 60],
        [181, 60],
        [190, 50],
        [170, 50],
      ],
    ]);
  });
});

describe('boundsOfRings', () => {
  it('returns the lon/lat bounding box', () => {
    const rings: Ring[] = [
      [
        [2, 48],
        [8, 44],
      ],
    ];
    expect(boundsOfRings(rings)).toEqual({ lonMin: 2, lonMax: 8, latMin: 44, latMax: 48 });
  });
  it('returns null for empty input', () => {
    expect(boundsOfRings([])).toBeNull();
  });
});

describe('lonSpan', () => {
  it('is lonMax - lonMin', () => {
    expect(lonSpan({ lonMin: 10, lonMax: 30, latMin: 0, latMax: 1 })).toBe(20);
  });
});

describe('chooseMinimalLonRepresentation', () => {
  it('unwraps a seam-crossing selection to the narrower span', () => {
    // A Russia-like pair of rings: one just west of +180, one just east of -180.
    const rings: Ring[] = [
      [
        [170, 60],
        [179, 60],
        [179, 50],
        [170, 50],
      ],
      [
        [-179, 60],
        [-175, 60],
        [-175, 50],
        [-179, 50],
      ],
    ];
    const chosen = chooseMinimalLonRepresentation(rings)!;
    expect(chosen.bbox.lonMax).toBeGreaterThan(180); // unwrapped past the seam
    expect(lonSpan(chosen.bbox)).toBeLessThan(180); // contiguous, not ~349°
  });

  it('leaves a genuinely-wide non-crossing selection untouched', () => {
    // France + French Guiana: 8°E and -54°W. Raw span 62°; unwrapping would balloon it to ~300°.
    const rings: Ring[] = [
      [
        [2, 48],
        [8, 48],
        [8, 44],
        [2, 44],
      ],
      [
        [-54, 5],
        [-52, 5],
        [-52, 3],
        [-54, 3],
      ],
    ];
    const chosen = chooseMinimalLonRepresentation(rings)!;
    expect(chosen.bbox.lonMin).toBe(-54);
    expect(chosen.rings).toBe(rings); // identity: raw representation kept
  });

  it('returns null for empty input', () => {
    expect(chooseMinimalLonRepresentation([])).toBeNull();
  });
});

describe('normalizeCropLon', () => {
  it('keeps an in-range crop unchanged', () => {
    expect(normalizeCropLon({ lonMin: 160, lonMax: 200, latMin: 50, latMax: 72 })).toEqual({
      lonMin: 160,
      lonMax: 200,
      latMin: 50,
      latMax: 72,
    });
  });
  it('canonicalizes a crop drawn entirely past +180 into the [-180,180) origin, preserving width', () => {
    expect(normalizeCropLon({ lonMin: 190, lonMax: 250, latMin: 0, latMax: 10 })).toEqual({
      lonMin: -170,
      lonMax: -110,
      latMin: 0,
      latMax: 10,
    });
  });
  it('canonicalizes a crop drawn past -180 into a wrapping crop', () => {
    expect(normalizeCropLon({ lonMin: -200, lonMax: -160, latMin: 0, latMax: 10 })).toEqual({
      lonMin: 160,
      lonMax: 200,
      latMin: 0,
      latMax: 10,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run antimeridian`
Expected: FAIL — `./antimeridian` module does not exist yet (import error).

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/features/builder/geo/antimeridian.ts`:

```ts
import type { Ring, Point } from './clip';
import type { CropBBox } from './projection';

/** Longitude span (degrees) of a bbox. */
export function lonSpan(bbox: CropBBox): number {
  return bbox.lonMax - bbox.lonMin;
}

/** Copy of `rings` with every point translated in longitude by `delta` (e.g. +360 / -360). */
export function shiftLon(rings: readonly Ring[], delta: number): Ring[] {
  return rings.map((ring) => ring.map(([lon, lat]) => [lon + delta, lat] as Point));
}

/** Copy of `rings` with every point whose lon < 0 shifted by +360° — per-point and conditional,
 *  NOT shiftLon(rings, 360). Only the western points move, which is what stitches an
 *  antimeridian-crossing landmass (e.g. Russia's -179° tip) contiguous with its eastern body. */
export function unwrapEast(rings: readonly Ring[]): Ring[] {
  return rings.map((ring) =>
    ring.map(([lon, lat]) => (lon < 0 ? ([lon + 360, lat] as Point) : ([lon, lat] as Point))),
  );
}

/** Lon/lat bounding box of a set of rings, or null for empty input. */
export function boundsOfRings(rings: readonly Ring[]): CropBBox | null {
  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < lonMin) lonMin = lon;
      if (lon > lonMax) lonMax = lon;
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
    }
  }
  if (!Number.isFinite(lonMin)) return null;
  return { lonMin, lonMax, latMin, latMax };
}

/** Pick whichever of {raw rings, east-unwrapped rings} has the smaller longitude span, so a
 *  seam-crossing selection (Russia, Fiji) becomes contiguous while a genuinely-wide but
 *  non-crossing selection (e.g. France + French Guiana) is left untouched. Null for empty input. */
export function chooseMinimalLonRepresentation(
  rings: readonly Ring[],
): { rings: readonly Ring[]; bbox: CropBBox } | null {
  const rawBbox = boundsOfRings(rings);
  if (!rawBbox) return null;
  const unwrapped = unwrapEast(rings);
  const unwrappedBbox = boundsOfRings(unwrapped)!;
  return lonSpan(unwrappedBbox) < lonSpan(rawBbox)
    ? { rings: unwrapped, bbox: unwrappedBbox }
    : { rings, bbox: rawBbox };
}

/** Canonicalize a crop's longitude so lonMin ∈ [-180, 180) while preserving its width. A crop that
 *  wraps the antimeridian keeps lonMax > 180 (e.g. 160→200); a crop drawn entirely past the seam
 *  folds back to normal (190→250 becomes -170→-110). Latitudes pass through untouched. */
export function normalizeCropLon(bbox: CropBBox): CropBBox {
  const span = bbox.lonMax - bbox.lonMin;
  const lonMin = ((((bbox.lonMin + 180) % 360) + 360) % 360) - 180;
  return { lonMin, lonMax: lonMin + span, latMin: bbox.latMin, latMax: bbox.latMax };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run antimeridian`
Expected: PASS — all cases in `antimeridian.test.ts` green.

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/geo/antimeridian.ts apps/web/src/features/builder/geo/antimeridian.test.ts
git commit -m "feat(web): add antimeridian longitude-unwrap geometry helpers"
```

---

### Task 2: Country-pick auto-unwraps seam-crossing countries

**Files:**

- Modify: `apps/web/src/features/builder/geo/world.ts` (imports at `:1-8`; delete private
  `boundsOfRings` at `:65-81`; rewrite `countriesToGeography` at `:114-120`)
- Test: `apps/web/src/features/builder/geo/world.test.ts` (extend the `countriesToGeography`
  describe block)

**Interfaces:**

- Consumes: `chooseMinimalLonRepresentation` from `./antimeridian` (Task 1).
- Produces: `countriesToGeography(ids: readonly string[]): CropResult | null` (signature unchanged;
  behavior now contiguous for seam crossers).

- [ ] **Step 1: Write the failing test**

Add these cases inside the existing `describe('countriesToGeography', ...)` block in
`apps/web/src/features/builder/geo/world.test.ts` (the file already imports `validateGeography`,
`countriesToGeography`):

```ts
it('builds seam-crossing Russia as one contiguous landmass, not two edge slivers', () => {
  const result = countriesToGeography(['RUS']);
  expect(result).not.toBeNull();
  const { geography } = result!;
  // Raw Russia spans lon -179.88°..179.49° (~359°), which split it in two. Unwrapped it is
  // ~19°..191° (~172°): a narrower span whose lonMax is pushed past the antimeridian.
  expect(geography.crop.lonMax - geography.crop.lonMin).toBeLessThan(200);
  expect(geography.crop.lonMax).toBeGreaterThan(180);
  expect(validateGeography(geography)).toEqual([]);
});

it('builds seam-crossing Fiji contiguously', () => {
  const result = countriesToGeography(['FJI']);
  expect(result).not.toBeNull();
  const { geography } = result!;
  expect(geography.crop.lonMax - geography.crop.lonMin).toBeLessThan(200);
  expect(geography.crop.lonMax).toBeGreaterThan(180);
  expect(validateGeography(geography)).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run world`
Expected: FAIL — the two new Russia/Fiji cases fail: today `geography.crop.lonMax - lonMin` is
~359 (not `< 200`) and `crop.lonMax` is ~179 (not `> 180`). All pre-existing `world.test.ts`
cases still pass.

- [ ] **Step 3: Update the imports and rewrite `countriesToGeography`**

In `apps/web/src/features/builder/geo/world.ts`, add the import (after the existing
`import { clipRingsToBBox, type Ring } from './clip';` line):

```ts
import { chooseMinimalLonRepresentation } from './antimeridian';
```

Delete the entire private `boundsOfRings` function (currently `:65-81`, the block starting
`/** The lon/lat bounding box of a set of rings, or null for an empty input. */` through its
closing `}`) — it now lives in `./antimeridian`.

Replace the body of `countriesToGeography` (currently `:114-120`) with:

```ts
export function countriesToGeography(ids: readonly string[]): CropResult | null {
  const idSet = new Set(ids);
  const rings = WORLD_COUNTRIES.filter((c) => idSet.has(c.id)).flatMap(ringsForCountry);
  const chosen = chooseMinimalLonRepresentation(rings);
  if (!chosen || !isValidCrop(chosen.bbox)) return null;
  return finalizeGeography(dissolveCountryRings(chosen.rings), chosen.bbox);
}
```

(Leave the doc comment above `countriesToGeography` in place.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run world`
Expected: PASS — the two new cases and all pre-existing `world.test.ts` cases pass. In particular
the "returns null for an empty selection", "returns null when no id matches", and the
France+Germany bbox cases are unchanged (empty rings → `chooseMinimalLonRepresentation` returns
null; non-crossers keep the raw representation).

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web exec tsc --noEmit`
Expected: no errors (no dangling reference to the deleted `boundsOfRings`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/geo/world.ts apps/web/src/features/builder/geo/world.test.ts
git commit -m "feat(web): country-pick renders seam-crossing countries as one piece"
```

---

### Task 3: `cropToGeography` clips across the antimeridian

**Files:**

- Modify: `apps/web/src/features/builder/geo/world.ts` (import `shiftLon`; add `clipWrapped`;
  rewrite `cropToGeography` at `:53-57`)
- Test: `apps/web/src/features/builder/geo/world.test.ts` (extend the `cropToGeography` describe
  block)

**Interfaces:**

- Consumes: `shiftLon` from `./antimeridian` (Task 1); `clipRingsToBBox` from `./clip` (existing).
- Produces: `cropToGeography(crop: CropBBox): CropResult | null` (signature unchanged; now
  wrap-aware when `crop.lonMax > 180` or `crop.lonMin < -180`).

- [ ] **Step 1: Write the failing test**

Add this case inside the existing `describe('cropToGeography', ...)` block in
`apps/web/src/features/builder/geo/world.test.ts`:

```ts
it('crops a region straddling the antimeridian, capturing land on both sides of the seam', () => {
  // 160°E..200°E (= 160°E..160°W): the Russian Far East sits at native lon (<180) and Alaska
  // sits past the seam (Alaska's ~-165° lands at 195° once shifted +360). A plain 160..180 crop
  // reaches only the Russian side, so the wrapping crop must yield strictly more land.
  const wrapped = cropToGeography({ lonMin: 160, lonMax: 200, latMin: 50, latMax: 72 });
  const eastOnly = cropToGeography({ lonMin: 160, lonMax: 180, latMin: 50, latMax: 72 });
  expect(wrapped).not.toBeNull();
  expect(eastOnly).not.toBeNull();
  expect(wrapped!.geography.land.length).toBeGreaterThan(eastOnly!.geography.land.length);
  expect(validateGeography(wrapped!.geography)).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run world`
Expected: FAIL — today `cropToGeography` clips only the native land, so `wrapped` misses Alaska and
its `land.length` is **not** greater than `eastOnly`'s.

- [ ] **Step 3: Add `clipWrapped` and rewrite `cropToGeography`**

In `apps/web/src/features/builder/geo/world.ts`, extend the antimeridian import to also bring in
`shiftLon`:

```ts
import { chooseMinimalLonRepresentation, shiftLon } from './antimeridian';
```

Replace `cropToGeography` (currently `:53-57`) and add `clipWrapped` just above it:

```ts
/** Clip world land to a crop that may wrap past the antimeridian (lonMax > 180 or lonMin < -180):
 *  clip the native land AND a ±360-shifted copy, so land on the far side of the seam is captured.
 *  The Natural Earth source splits seam features into separate per-side rings, so no single ring is
 *  torn by the shift. A non-wrapping crop skips both extra clips and behaves exactly as before. */
function clipWrapped(rings: readonly Ring[], crop: CropBBox): Ring[] {
  const out = clipRingsToBBox(rings, crop);
  if (crop.lonMax > 180) out.push(...clipRingsToBBox(shiftLon(rings, 360), crop));
  if (crop.lonMin < -180) out.push(...clipRingsToBBox(shiftLon(rings, -360), crop));
  return out;
}

/** Full crop pipeline: clip the world to the bbox (wrap-aware; see clipWrapped), simplify to fit
 *  the engine's caps (validateGeography's limits), then project into board space. Null on an
 *  invalid crop. */
export function cropToGeography(crop: CropBBox): CropResult | null {
  if (!isValidCrop(crop)) return null;
  const clipped = clipWrapped(WORLD_LAND_DETAILED, crop);
  return finalizeGeography(clipped, crop);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run world`
Expected: PASS — the new seam-crossing case and every pre-existing `cropToGeography` case pass
(non-wrapping crops like the Japan and empty-ocean cases hit only the first `clipRingsToBBox`).

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/geo/world.ts apps/web/src/features/builder/geo/world.test.ts
git commit -m "feat(web): clip world crops across the antimeridian"
```

---

### Task 4: `isValidCrop` rejects a ≥360°-wide crop

**Files:**

- Modify: `apps/web/src/features/builder/geo/projection.ts` (`isValidCrop` at `:30-46`)
- Test: `apps/web/src/features/builder/geo/projection.test.ts` (extend the `isValidCrop` block)

**Interfaces:**

- Produces: `isValidCrop(crop: CropBBox): boolean` (signature unchanged; now also rejects a crop
  whose longitude span is ≥ 360°). A wrapping crop under 360° wide (e.g. 160→200) still passes.

- [ ] **Step 1: Write the failing test**

Add these cases inside the existing `describe('isValidCrop', ...)` block in
`apps/web/src/features/builder/geo/projection.test.ts`:

```ts
it('rejects a crop spanning 360° or more', () => {
  expect(isValidCrop({ lonMin: -180, lonMax: 180, latMin: 0, latMax: 10 })).toBe(false);
  expect(isValidCrop({ lonMin: 0, lonMax: 360, latMin: 0, latMax: 10 })).toBe(false);
});

it('accepts a crop that wraps past +180 but stays under 360° wide', () => {
  expect(isValidCrop({ lonMin: 160, lonMax: 200, latMin: 50, latMax: 72 })).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run projection`
Expected: FAIL — the "rejects a crop spanning 360° or more" case fails: today a `-180..180` crop
(span exactly 360) passes `isValidCrop`.

- [ ] **Step 3: Add the span guard**

In `apps/web/src/features/builder/geo/projection.ts`, add one clause to the `isValidCrop` return
(immediately after the `crop.lonMin < crop.lonMax &&` line):

```ts
    crop.lonMin < crop.lonMax &&
    // A crop can wrap past ±180 (lonMax > 180) but never span a full turn or more — that would be
    // a degenerate whole-world selection with no meaningful projection.
    crop.lonMax - crop.lonMin < 360 &&
```

Leave the rest of the function (finiteness checks, latitude clamp) unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run projection`
Expected: PASS — the two new cases and all pre-existing `isValidCrop`/`buildProjection` cases pass
(the widest existing accepted crop is Greenland at ~61° span; the ≥360 guard doesn't touch it).

- [ ] **Step 5: Re-run the world tests (shared validator)**

Run: `yarn workspace @trm/web test --run world`
Expected: PASS — the Russia/Fiji unwrapped crops (spans ~172° / ~5°) and the seam crop (span 40°)
are all under 360°, so `isValidCrop` still accepts them.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/geo/projection.ts apps/web/src/features/builder/geo/projection.test.ts
git commit -m "feat(web): reject a 360°-or-wider crop bbox"
```

---

### Task 5: Crop-draw panorama — draw a rectangle across the seam

**Files:**

- Modify: `apps/web/src/features/builder/editor/stages/CropDrawStage.tsx`
- Test: `apps/web/src/features/builder/editor/stages/CropDrawStage.test.tsx` (extend)

**Interfaces:**

- Consumes: `normalizeCropLon` from `../../geo/antimeridian` (Task 1); `cropToGeography` (Task 3).
- Produces: no exported API change — `CropDrawStage` is a route component. Its stored
  `draft.geography.crop` may now have `lonMax > 180` for a seam-crossing crop.

**Notes for the implementer:**

- The world map is drawn in the SVG's own user space where `x = lon`, `y = -lat`. Rendering the
  land/graticule/sea at longitude offsets `[-360, 0, +360]` creates three side-by-side world copies
  spanning user-space x ∈ [-540, 540]. `react-zoom-pan-pinch` shows one world at `initialScale=3`,
  centered — so the **initial view is unchanged** — and lets the user pan (middle-click) into the
  neighbor copies to draw across a seam.
- Display vs. canonical geometry are deliberately separated: the on-map rectangle overlay renders
  from the **raw** `rect` (wherever the user drew it, possibly at x>180), while the preview and the
  committed geography come from `normalizeCropLon(rect)`. Both project to identical board
  coordinates; only the stored `crop` differs (canonical), which is what we want for hashing and
  re-open.

- [ ] **Step 1: Write the failing test**

Add this case to `apps/web/src/features/builder/editor/stages/CropDrawStage.test.tsx` (the file's
`clientToBoardPoint` mock is an identity map, so `drawRect([lon,lat],[lon,lat])` drives lon/lat
directly — a `lon=200` corner is reachable):

```ts
  it('draws a crop straddling the antimeridian and stores a canonical wrapping crop', () => {
    const { container } = render(<CropDrawStage />);
    const svg = container.querySelector('svg.editor-world')!;
    // 160°E..200°E across the seam, high-latitude Bering band.
    drawRect(svg, [160, 50], [200, 72]);
    expect(container.querySelectorAll('.editor-crop-preview-svg path').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('確認裁切並繼續'));
    const crop = useEditorStore.getState().draft.geography!.crop;
    expect(crop.lonMin).toBe(160);
    expect(crop.lonMax).toBe(200); // wrapping crop preserved (lonMax > 180)
  });
```

Also add a rendering assertion to the existing `describe('CropDrawStage', ...)` block:

```ts
  it('renders the world land as a three-copy panorama', () => {
    const { container } = render(<CropDrawStage />);
    // Same land ring set drawn at -360 / 0 / +360; land path count is a multiple of 3.
    const landPaths = container.querySelectorAll('svg.editor-world path.editor-world-land');
    expect(landPaths.length).toBeGreaterThan(0);
    expect(landPaths.length % 3).toBe(0);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run CropDrawStage`
Expected: FAIL — the panorama case fails because land is rendered once (not a multiple of 3), and
the seam-crop case fails because today `rect` normalizes `lonMin/lonMax` via `Math.min/Math.max`
without wrap handling, and `cropToGeography` (pre-Task-3) wouldn't capture wrapped land. The four
pre-existing cases still pass.

- [ ] **Step 3: Rewrite the panorama render, scale config, and canonical crop derivation**

In `apps/web/src/features/builder/editor/stages/CropDrawStage.tsx`:

Add the import (with the other geo import):

```ts
import { worldLand, cropToGeography } from '../../geo/world';
import { normalizeCropLon } from '../../geo/antimeridian';
```

Replace the `WORLD_VIEWBOX` constant (currently `:11`) and add the offsets + graticule constants:

```ts
const WORLD_VIEWBOX = { x: -540, y: -90, w: 1080, h: 180 };
/** The world is drawn three times, at these longitude offsets, so a crop rectangle can be dragged
 *  across the ±180° seam. Offset 0 is the normal world; ±360 are its wrap-around copies. */
const WORLD_OFFSETS = [-360, 0, 360] as const;
const GRATICULE_LONS = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150] as const;
const GRATICULE_LATS = [-60, -30, 0, 30, 60] as const;
```

Change the `latSpan` + `result` derivation (currently `:84-86`) to project through the canonical
crop while keeping the raw `rect` for the overlay:

```ts
const latSpan = rect ? rect.latMax - rect.latMin : 0;
const canonicalRect = rect ? normalizeCropLon(rect) : null;
const result =
  canonicalRect &&
  canonicalRect.lonMin < canonicalRect.lonMax &&
  canonicalRect.latMin < canonicalRect.latMax
    ? cropToGeography(canonicalRect)
    : null;
```

Update the `TransformWrapper` props (currently `:164-173`) so one world fills the frame at the base
scale and panning reaches the neighbor copies:

```tsx
          <TransformWrapper
            minScale={3}
            maxScale={192}
            initialScale={3}
            centerOnInit
            wheel={{ step: 0.0022 }}
            doubleClick={{ disabled: true }}
            panning={{ allowLeftClickPan: false, allowMiddleClickPan: true }}
          >
```

Replace the SVG's static sea + graticule + land block (currently `:195-210`, the single
`<rect ... editor-world-sea>`, the `<g editor-world-graticule>`, and the `worldLand().map(...)`)
with the three-copy panorama:

```tsx
{
  WORLD_OFFSETS.map((off) => (
    <g key={`world${off}`}>
      <rect x={-180 + off} y={-90} width={360} height={180} className="editor-world-sea" />
      <g className="editor-world-graticule">
        {GRATICULE_LONS.map((lon) => (
          <line key={`gx${off}_${lon}`} x1={lon + off} y1={-90} x2={lon + off} y2={90} />
        ))}
        {GRATICULE_LATS.map((lat) => (
          <line key={`gy${off}_${lat}`} x1={-180 + off} y1={-lat} x2={180 + off} y2={-lat} />
        ))}
      </g>
      {worldLand().map((ring, i) => (
        <path
          key={`land${off}_${i}`}
          d={`M ${ring.map(([lon, lat]) => `${lon + off},${-lat}`).join(' L ')} Z`}
          className="editor-world-land"
        />
      ))}
    </g>
  ));
}
```

Leave the crop-rectangle `<g className="editor-crop-group">` block (the `rect` + handles, currently
`:211-234`) exactly as-is — it renders from the raw `rect`, so a rectangle drawn at x>180 shows in
the `+360` copy where the user drew it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run CropDrawStage`
Expected: PASS — the two new cases and the four pre-existing cases pass. The Japan draw/confirm/
redraw cases are unaffected (128..146 is in-range, so `normalizeCropLon` is a no-op there).

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Lint (engine/purity + JSX-key rules)**

Run: `yarn workspace @trm/web exec eslint src/features/builder/editor/stages/CropDrawStage.tsx src/features/builder/geo/world.ts src/features/builder/geo/antimeridian.ts`
Expected: clean (no unused `WORLD_VIEWBOX`/import warnings; all mapped elements keyed).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/builder/editor/stages/CropDrawStage.tsx apps/web/src/features/builder/editor/stages/CropDrawStage.test.tsx
git commit -m "feat(web): pannable panorama crop that can straddle the antimeridian"
```

---

### Task 6: Full-suite verification & manual smoke check

**Files:** none (verification only).

- [ ] **Step 1: Run the web workspace's full test + typecheck + lint**

Run: `yarn workspace @trm/web test --run && yarn workspace @trm/web exec tsc --noEmit && yarn workspace @trm/web exec eslint src/features/builder`
Expected: all green — no regressions across the builder feature.

- [ ] **Step 2: Manual smoke check (dev server)**

Bring up Mongo + server + web if not already running, per the root `CLAUDE.md`:

```bash
docker compose up -d mongo
yarn workspace @trm/server dev
yarn workspace @trm/web dev
```

Verify in the builder (`/maps/:id/edit`, Crop stage), with the `mapBuilder` feature granted:

1. **Pick-countries mode → Russia**: select Russia; the preview shows one contiguous landmass (no
   two slivers hugging opposite edges). Repeat for Fiji.
2. **Draw mode → normal crop**: draw a rectangle over Taiwan/Japan — initial framing and behavior
   unchanged from before.
3. **Draw mode → seam crop**: middle-click-pan east past the right edge into the wrap-around copy,
   then draw a rectangle spanning the date line (e.g. Russian Far East + Alaska). The preview shows
   both sides as one crop.

- [ ] **Step 3: (If a project verify skill exists) run it**

Run: `/verify` (or the project's documented end-to-end verification) against the builder crop flow.
Expected: the seam-crossing crop and country-pick render contiguously.

- [ ] **Step 4: Update the knowledge graph**

Run: `graphify update .`
Expected: graph refresh completes (AST-only, no API cost), per the root `CLAUDE.md`.

---

## Self-Review

- **Spec coverage:**
  - Core longitude-unwrap primitive + `geo/antimeridian.ts` module → Task 1.
  - Path 1 (country-pick auto-unwrap, RUS/FJI, no UI change) → Task 2.
  - Path 2 crop-draw panorama (3-copy render, scale config, `normalizeCropLon`) → Task 5;
    `cropToGeography` wrap-aware clip → Task 3.
  - `isValidCrop` span guard → Task 4.
  - Determinism / non-regression → enforced by keeping existing tests green in every task, plus
    Task 6 full-suite run.
  - Testing section (antimeridian unit tests, world RUS/FJI + seam crop, CropDrawStage panorama +
    canonical crop) → Tasks 1, 2, 3, 5.
  - Out-of-scope items (CountryPickStage selection-map cosmetics, auto-centering re-opened wrap
    crop, server/proto/engine/map-data changes) → correctly untouched.
- **Placeholder scan:** none — every code step shows literal code and every run step shows the exact
  command + expected result.
- **Type consistency:** `chooseMinimalLonRepresentation` returns `{ rings, bbox }` and is consumed
  as `chosen.rings` / `chosen.bbox` in Task 2; `shiftLon(rings, delta)` is defined in Task 1 and
  called with `+360` / `-360` in Task 3; `normalizeCropLon(bbox) → CropBBox` is defined in Task 1
  and consumed in Task 5; `boundsOfRings` is defined once in `antimeridian.ts` (Task 1) and the
  duplicate in `world.ts` is deleted (Task 2). `CropBBox` / `Ring` / `Point` names match their
  source modules throughout.
