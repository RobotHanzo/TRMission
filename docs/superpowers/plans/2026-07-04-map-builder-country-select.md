# Map Builder Country-Select Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second way to define a custom map's geography in the builder's Crop stage — pick one or more countries by map-click or a searchable list, and get their combined silhouette directly, without dragging a rectangle and without dragging in unwanted neighbours.

**Architecture:** A new vendored per-country dataset (`geo/worldCountries.ts`, Natural Earth admin-0 countries, same generation recipe as the existing `geo/worldData.ts`) feeds a new `countriesToGeography(ids)` function in `geo/world.ts` that mirrors the existing `cropToGeography(bbox)` but sources rings directly from selected countries instead of clipping the world landmass to a rectangle. `CropStage.tsx` is split into a thin mode-toggle shell plus two children: today's rectangle-drag UI (moved verbatim into `CropDrawStage.tsx`) and a new `CountryPickStage.tsx` (clickable world map + searchable sidebar list, reusing `countriesToGeography`).

**Tech Stack:** React + TypeScript, Zustand (`editor/store.ts`), react-i18next, Vitest + @testing-library/react, `react-zoom-pan-pinch` (existing canvas pan/zoom).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-map-builder-country-select-design.md` (read it for full rationale).
- UI ships in **Traditional Chinese (primary) + English** — every new user-facing string needs both `zh-Hant` and `en` entries in `apps/web/src/i18n/index.ts`.
- This entire feature lives under `apps/web/src/features/builder/` — a lazy-loaded route chunk. It must **never inflate the main bundle**; verify chunk sizes with `yarn workspace @trm/web build` in the final task.
- No runtime fetch / GeoJSON parsing in the shipped app — country geometry is vendored as a static TS module, exactly like `geo/worldData.ts` already is.
- Determinism/rounding: geography coordinates are rounded to 2 decimals before ever being hashed (`round2` in `geo/projection.ts`) — any new code path that produces `MapGeography.land` must go through the existing `buildProjection`/`simplifyToFit` pipeline, not hand-rolled rounding.
- **Multiple agents may be working in this worktree at once.** Before committing, run `git status`/`git diff` and stage only the files each task actually changed — never `git add -A`/`git add .`.
- Verification commands: `yarn workspace @trm/web test --run <path or substring>` (Vitest), `yarn workspace @trm/web typecheck`, `yarn lint` (from repo root), `yarn workspace @trm/web build`.

---

### Task 1: Relax `isValidCrop`'s polar bound so real large countries are selectable

**Why this is first:** `countriesToGeography` (Task 3) will feed `isValidCrop` a bounding box computed from real countries' actual extents. Natural Earth's data puts Greenland's northern tip at **83.65°N**, Canada at **83.23°N**, Russia at **81.25°N**, Norway at **80.66°N** — all beyond the current `±80°` gate, which would silently reject perfectly ordinary single-country selections. Antarctica (which does need rejecting — it reaches **-90°**) will be excluded from the vendored dataset entirely in Task 2, so it's not a reason to loosen this further.

**Files:**
- Modify: `apps/web/src/features/builder/geo/projection.ts:30-41` (`isValidCrop`)
- Modify: `apps/web/src/features/builder/geo/projection.test.ts:12-15` (existing `isValidCrop` describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `isValidCrop(crop: CropBBox): boolean` — same signature, only the polar threshold changes from 80 to 84. `CropBBox = { lonMin: number; lonMax: number; latMin: number; latMax: number }` (already defined in this file, unchanged).

- [ ] **Step 1: Update the existing test to lock in both the still-invalid case and the newly-valid one**

In `apps/web/src/features/builder/geo/projection.test.ts`, replace the `'rejects latitudes beyond the polar clamp'` test:

```ts
  it('rejects latitudes beyond the polar clamp', () => {
    expect(isValidCrop({ lonMin: 0, lonMax: 10, latMin: -85, latMax: 10 })).toBe(false);
    expect(isValidCrop({ lonMin: 0, lonMax: 10, latMin: 0, latMax: 85 })).toBe(false);
  });

  it('accepts real-world high-latitude country extents (Greenland reaches 83.65°N)', () => {
    expect(isValidCrop({ lonMin: -73.3, lonMax: -12.21, latMin: 60.04, latMax: 83.65 })).toBe(true);
    expect(isValidCrop({ lonMin: 0, lonMax: 10, latMin: 0, latMax: 84 })).toBe(true);
  });
```

- [ ] **Step 2: Run the test to see the new assertion fail**

Run: `yarn workspace @trm/web test --run projection`
Expected: FAIL — the new `'accepts real-world high-latitude country extents'` test fails because `isValidCrop` still rejects anything past 80°.

- [ ] **Step 3: Widen the bound in `projection.ts`**

In `apps/web/src/features/builder/geo/projection.ts`, replace the `isValidCrop` function:

```ts
export function isValidCrop(crop: CropBBox): boolean {
  return (
    Number.isFinite(crop.lonMin) &&
    Number.isFinite(crop.lonMax) &&
    Number.isFinite(crop.latMin) &&
    Number.isFinite(crop.latMax) &&
    crop.lonMin < crop.lonMax &&
    crop.latMin < crop.latMax &&
    // 80° originally left no headroom for real countries: Greenland reaches 83.65°N, Canada
    // 83.23°N, Russia 81.25°N, Norway 80.66°N (all real Natural Earth extents) — widened to 84°
    // so the country-select mode (geo/world.ts's countriesToGeography) can select them. Antarctica
    // (reaches -90°) is excluded from the country dataset entirely (geo/worldCountries.ts) rather
    // than accommodated here.
    crop.latMin >= -84 &&
    crop.latMax <= 84
  );
}
```

- [ ] **Step 4: Run the full projection test file to confirm everything passes**

Run: `yarn workspace @trm/web test --run projection`
Expected: PASS — all tests in `projection.test.ts` green (both the updated `isValidCrop` block and the untouched `buildProjection` block).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/builder/geo/projection.ts apps/web/src/features/builder/geo/projection.test.ts
git commit -m "fix(web): widen isValidCrop's polar bound for real country extents"
```

---

### Task 2: Generate and vendor `geo/worldCountries.ts`

**Files:**
- Create: `apps/web/src/features/builder/geo/worldCountries.ts` (generated — see script below)
- Create: `apps/web/src/features/builder/geo/worldCountries.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface CountryLand {
    readonly id: string;       // Natural Earth ADM0_A3 code, e.g. "TWN", "JPN", "FRA"
    readonly nameEn: string;
    readonly nameZh: string;   // Traditional Chinese
    readonly continent: string; // one of: "Africa" | "Asia" | "Europe" | "North America" | "South America" | "Oceania"
    readonly rings: readonly Ring[]; // Ring = readonly (readonly [number, number])[] from './clip', lon/lat points, exterior ring(s) only
  }
  export const WORLD_COUNTRIES: readonly CountryLand[]; // 175 entries, sorted by continent then nameEn
  ```
  Later tasks import `WORLD_COUNTRIES` and the `CountryLand` type from `'./worldCountries'` (from `geo/`) or `'../../geo/worldCountries'` (from `editor/stages/`).

This task's "test" is generating real data, so the useful order is: write the generator, run it, then write assertions against the concrete output (the exact counts below are already verified against the live Natural Earth snapshot fetched during planning — they are not placeholders).

- [ ] **Step 1: Fetch the source GeoJSON**

Run (needs network access):
```bash
curl -s --max-time 20 "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson" -o /tmp/ne_countries.geojson
wc -c /tmp/ne_countries.geojson
```
Expected: a file of roughly 830-840 KB. (If your environment has no network access, this step cannot be completed by you directly — ask the user for the file, or for permission to fetch it, before proceeding; do not fabricate the dataset.)

- [ ] **Step 2: Write the generator script**

Create `/tmp/gen-world-countries.cjs` (a throwaway script — do not commit it, matching how `geo/worldData.ts` itself has no generator script checked into the repo):

```js
const fs = require('fs');

const SRC = '/tmp/ne_countries.geojson';
const OUT = '/tmp/worldCountries.generated.ts';
const TOLERANCE = 0.03; // same tolerance geo/worldData.ts's own land data uses
const EXCLUDED_CONTINENTS = new Set(['Antarctica', 'Seven seas (open ocean)']);

function perpendicularDistance(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / len2;
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(x - cx, y - cy);
}
function simplifyPolyline(points, tolerance) {
  if (points.length <= 2) return points.slice();
  let maxDist = -1, maxIdx = 0;
  const first = points[0], last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist <= tolerance) return [first, last];
  const left = simplifyPolyline(points.slice(0, maxIdx + 1), tolerance);
  const right = simplifyPolyline(points.slice(maxIdx), tolerance);
  return [...left.slice(0, -1), ...right];
}
function simplifyRing(ring, tolerance) {
  if (ring.length <= 3 || tolerance <= 0) return ring;
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  let anchor = 0, maxD = -1;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - cx, ring[i][1] - cy);
    if (d > maxD) { maxD = d; anchor = i; }
  }
  const rotated = [...ring.slice(anchor), ...ring.slice(0, anchor), ring[anchor]];
  return simplifyPolyline(rotated, tolerance).slice(0, -1);
}
function round2(v) { return Math.round(v * 100) / 100; }
function cleanRing(ring) {
  const out = [];
  for (const [lon, lat] of ring) {
    const p = [round2(lon), round2(lat)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  if (out.length >= 2) {
    const f = out[0], l = out[out.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) out.pop();
  }
  return out;
}

const gj = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const countries = [];
for (const f of gj.features) {
  const p = f.properties;
  if (EXCLUDED_CONTINENTS.has(p.CONTINENT)) continue;
  const g = f.geometry;
  // Interior rings are holes (e.g. a lake) — same reasoning as geo/worldData.ts's own exterior-
  // ring-only fix. Keep exterior ring(s) only.
  const exteriorRings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((poly) => poly[0]);
  const rings = exteriorRings
    .map((r) => cleanRing(simplifyRing(r, TOLERANCE)))
    .filter((r) => r.length >= 3);
  if (rings.length === 0) continue;
  countries.push({ id: p.ADM0_A3, nameEn: p.NAME_EN, nameZh: p.NAME_ZHT, continent: p.CONTINENT, rings });
}
// Taiwan gets this game's own hand-authored coastline everywhere else (geo/taiwan.ts, geo/world.ts's
// WORLD_LAND_DETAILED) instead of Natural Earth's own — and this game calls it "Taiwan"/"台灣"
// throughout, not the formal "Republic of China"/"中華民國" Natural Earth's NAME_ZHT/NAME_EN carry.
// Override the display name only; geo/world.ts's countriesToGeography splices in the detailed
// silhouette itself (rings here become unused for id 'TWN', but stay as a harmless fallback).
const twn = countries.find((c) => c.id === 'TWN');
if (twn) { twn.nameEn = 'Taiwan'; twn.nameZh = '台灣'; }

countries.sort((a, b) => (a.continent < b.continent ? -1 : a.continent > b.continent ? 1 : a.nameEn < b.nameEn ? -1 : 1));

console.log('countries:', countries.length);
console.log('continents:', [...new Set(countries.map((c) => c.continent))].join(', '));

function fmtRing(ring) { return `[${ring.map((p) => `[${p[0]},${p[1]}]`).join(',')}]`; }
function esc(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
const body = countries
  .map((c) => `  { id: '${c.id}', nameEn: '${esc(c.nameEn)}', nameZh: '${esc(c.nameZh)}', continent: '${esc(c.continent)}', rings: [${c.rings.map(fmtRing).join(',')}] }`)
  .join(',\n');

const out = `// Country-level land outlines for the map builder's "pick countries" crop mode: Natural Earth
// 1:110m admin-0 country polygons (public domain, https://www.naturalearthdata.com/), simplified
// with the same Douglas-Peucker algorithm as geo/simplify.ts (tolerance ${TOLERANCE}°, rounded to
// 0.01°) and vendored as a flat array so the builder needs no runtime fetch or GeoJSON parser.
// Only each polygon's exterior ring is kept (see geo/worldData.ts for why — interior rings are
// inland-water holes). Antarctica and the "Seven seas (open ocean)" bucket (French Southern &
// Antarctic Lands) are excluded: Antarctica's real extent reaches lat -90, which
// projection.ts's isValidCrop rejects, and neither is a plausible pick for this game. Taiwan's
// name is overridden to this game's own "Taiwan"/"台灣" (see geo/taiwan.ts) rather than Natural
// Earth's formal "Republic of China"/"中華民國". Source snapshot via
// https://github.com/nvkelso/natural-earth-vector geojson/ne_110m_admin_0_countries.geojson.
import type { Ring } from './clip';

export interface CountryLand {
  readonly id: string;
  readonly nameEn: string;
  readonly nameZh: string;
  readonly continent: string;
  readonly rings: readonly Ring[];
}

export const WORLD_COUNTRIES: readonly CountryLand[] = [
${body}
];
`;

fs.writeFileSync(OUT, out);
console.log('bytes:', Buffer.byteLength(out));
```

- [ ] **Step 3: Run the generator and copy the output into the repo**

Run:
```bash
node /tmp/gen-world-countries.cjs
```
Expected output: `countries: 175`, `continents: Africa, Asia, Europe, North America, Oceania, South America` (or the same six names in a different enumeration order — order doesn't matter, only that all six and only these six appear), and a `bytes:` line around 145-155 KB.

Then:
```bash
cp /tmp/worldCountries.generated.ts apps/web/src/features/builder/geo/worldCountries.ts
```

- [ ] **Step 4: Write the data-invariant test**

Create `apps/web/src/features/builder/geo/worldCountries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WORLD_COUNTRIES } from './worldCountries';

describe('WORLD_COUNTRIES', () => {
  it('has exactly 175 countries (tied to this Natural Earth snapshot)', () => {
    expect(WORLD_COUNTRIES.length).toBe(175);
  });

  it('has no duplicate ids', () => {
    const ids = new Set(WORLD_COUNTRIES.map((c) => c.id));
    expect(ids.size).toBe(WORLD_COUNTRIES.length);
  });

  it('excludes Antarctica and the open-ocean bucket', () => {
    const continents = new Set(WORLD_COUNTRIES.map((c) => c.continent));
    expect(continents.has('Antarctica')).toBe(false);
    expect(continents.has('Seven seas (open ocean)')).toBe(false);
    expect([...continents].sort()).toEqual([
      'Africa',
      'Asia',
      'Europe',
      'North America',
      'Oceania',
      'South America',
    ]);
  });

  it('gives every ring at least 3 points', () => {
    for (const c of WORLD_COUNTRIES) {
      for (const ring of c.rings) {
        expect(ring.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('carries Taiwan with this game\'s own display name, not the formal Natural Earth one', () => {
    const twn = WORLD_COUNTRIES.find((c) => c.id === 'TWN');
    expect(twn).toBeDefined();
    expect(twn!.nameEn).toBe('Taiwan');
    expect(twn!.nameZh).toBe('台灣');
    expect(twn!.continent).toBe('Asia');
  });

  it('includes real high-latitude countries the widened isValidCrop bound now permits', () => {
    for (const id of ['GRL', 'CAN', 'RUS', 'NOR']) {
      expect(WORLD_COUNTRIES.some((c) => c.id === id)).toBe(true);
    }
  });
});
```

- [ ] **Step 5: Run the test**

Run: `yarn workspace @trm/web test --run worldCountries`
Expected: PASS — all 6 assertions green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/geo/worldCountries.ts apps/web/src/features/builder/geo/worldCountries.test.ts
git commit -m "feat(web): vendor per-country land outlines for the map builder"
```

---

### Task 3: `countriesToGeography` in `geo/world.ts`

**Files:**
- Modify: `apps/web/src/features/builder/geo/world.ts` (full file, 49 lines today)
- Modify: `apps/web/src/features/builder/geo/world.test.ts` (full file, 31 lines today)

**Interfaces:**
- Consumes:
  - `WORLD_COUNTRIES: readonly CountryLand[]` and `interface CountryLand { id: string; nameEn: string; nameZh: string; continent: string; rings: readonly Ring[] }` from `./worldCountries` (Task 2).
  - `taiwanRings(): Ring[]` from `./taiwan` (already imported in this file today).
  - `Ring = readonly (readonly [number, number])[]`, `clipRingsToBBox` from `./clip` (already imported).
  - `buildProjection(crop: CropBBox): { baseView, project, unproject }`, `isValidCrop(crop: CropBBox): boolean`, `type CropBBox = { lonMin: number; lonMax: number; latMin: number; latMax: number }` from `./projection` (already imported; `isValidCrop`'s bound is now ±84 per Task 1).
  - `simplifyToFit(rings, opts: { startTolerance?: number; maxVertices: number; maxRings: number }): { rings: Ring[]; droppedRings: number }` from `./simplify` (already imported).
- Produces:
  ```ts
  export interface CropResult { geography: MapGeography; droppedRings: number } // unchanged, already exists
  export function cropToGeography(crop: CropBBox): CropResult | null; // unchanged behavior, refactored internals
  export function countriesToGeography(ids: readonly string[]): CropResult | null; // new
  ```
  `CountryPickStage.tsx` (Task 6) calls `countriesToGeography(ids)`.

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/features/builder/geo/world.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { validateGeography } from '@trm/map-data';
import { cropToGeography, countriesToGeography } from './world';
import { WORLD_COUNTRIES } from './worldCountries';

describe('cropToGeography', () => {
  it('returns null for an invalid crop', () => {
    expect(cropToGeography({ lonMin: 10, lonMax: 5, latMin: 0, latMax: 10 })).toBeNull();
  });

  it('crops Japan into a valid, engine-checkable MapGeography', () => {
    const result = cropToGeography({ lonMin: 128, lonMax: 146, latMin: 30, latMax: 46 });
    expect(result).not.toBeNull();
    const { geography, droppedRings } = result!;
    expect(geography.land.length).toBeGreaterThan(0);
    expect(droppedRings).toBe(0);
    expect(validateGeography(geography)).toEqual([]);
  });

  it('produces no land for an empty-ocean crop', () => {
    const result = cropToGeography({ lonMin: -170, lonMax: -160, latMin: -10, latMax: 0 });
    expect(result).not.toBeNull();
    expect(result!.geography.land).toEqual([]);
  });

  it('is deterministic for the same crop', () => {
    const crop = { lonMin: -10, lonMax: 5, latMin: 48, latMax: 60 };
    const a = cropToGeography(crop);
    const b = cropToGeography(crop);
    expect(a).toEqual(b);
  });
});

describe('countriesToGeography', () => {
  it('returns null for an empty selection', () => {
    expect(countriesToGeography([])).toBeNull();
  });

  it('returns null when no id matches', () => {
    expect(countriesToGeography(['ZZZ'])).toBeNull();
  });

  it('builds a valid geography for a single country', () => {
    const result = countriesToGeography(['JPN']);
    expect(result).not.toBeNull();
    const { geography, droppedRings } = result!;
    expect(geography.land.length).toBeGreaterThan(0);
    expect(droppedRings).toBe(0);
    expect(validateGeography(geography)).toEqual([]);
  });

  it('excludes a neighbour that falls inside the union bbox but was not selected', () => {
    const picked = countriesToGeography(['FRA', 'DEU']);
    expect(picked).not.toBeNull();
    // France + Germany's combined bounding box also fully contains Belgium, the Netherlands,
    // Luxembourg, and Switzerland — a rectangular crop over that same box would pick all of them
    // up too, so it must produce strictly more land rings than the two-country selection.
    const bboxCrop = cropToGeography(picked!.geography.crop);
    expect(bboxCrop).not.toBeNull();
    expect(bboxCrop!.geography.land.length).toBeGreaterThan(picked!.geography.land.length);
  });

  it("splices in the game's detailed Taiwan silhouette, not the crude admin-0 outline", () => {
    const crude = WORLD_COUNTRIES.find((c) => c.id === 'TWN')!;
    const result = countriesToGeography(['TWN']);
    expect(result).not.toBeNull();
    const main = result!.geography.land.reduce((a, b) => (b.length > a.length ? b : a));
    expect(main.length).toBeGreaterThan(crude.rings[0]!.length);
  });

  it('accepts a real high-latitude single-country selection (Greenland)', () => {
    const result = countriesToGeography(['GRL']);
    expect(result).not.toBeNull();
    expect(validateGeography(result!.geography)).toEqual([]);
  });

  it('is deterministic for the same selection', () => {
    const a = countriesToGeography(['ITA']);
    const b = countriesToGeography(['ITA']);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run the tests to confirm the new ones fail**

Run: `yarn workspace @trm/web test --run geo/world.test`
Expected: the four existing `cropToGeography` tests PASS unchanged; every `countriesToGeography` test FAILS with `countriesToGeography is not a function` (not yet exported).

- [ ] **Step 3: Implement `countriesToGeography`, refactoring the shared tail out of `cropToGeography`**

Replace `apps/web/src/features/builder/geo/world.ts` in full:

```ts
import type { MapGeography } from '@trm/map-data';
import { WORLD_LAND } from './worldData';
import { isCrudeTaiwanRing, taiwanRings } from './taiwan';
import { WORLD_COUNTRIES, type CountryLand } from './worldCountries';
import { buildProjection, isValidCrop, type CropBBox } from './projection';
import { clipRingsToBBox, type Ring } from './clip';
import { simplifyToFit } from './simplify';

/** Natural Earth's 1:110m Taiwan is a crude 4-point blob — swapped for the game's own detailed
 *  silhouette (see geo/taiwan.ts) so Taiwan reads correctly once the crop tool is zoomed in. */
const WORLD_LAND_DETAILED: readonly Ring[] = WORLD_LAND.flatMap((ring) =>
  isCrudeTaiwanRing(ring) ? taiwanRings() : [ring],
);

export function worldLand() {
  return WORLD_LAND_DETAILED;
}

export interface CropResult {
  geography: MapGeography;
  /** Land rings dropped for being too small after simplification, or over the ring cap —
   *  surfaced so the crop UI can warn rather than silently truncate. */
  droppedRings: number;
}

/** simplifyToFit's default starting tolerance (0.05°) is tuned for a whole-world-ish crop; a
 *  tight crop around a small feature (e.g. Taiwan's outlying islands, each only ~0.03-0.06°
 *  across) needs a proportionally finer tolerance or Douglas-Peucker collapses it below the
 *  3-point floor and drops it — "too small" regardless of how small the crop itself is. Scaled
 *  to the crop's own span (clamped to the same 0.05° ceiling so a wide crop is unaffected). */
function startToleranceFor(crop: CropBBox): number {
  const avgSpan = (crop.lonMax - crop.lonMin + (crop.latMax - crop.latMin)) / 2;
  return Math.max(0.002, Math.min(0.05, avgSpan / 500));
}

/** Shared tail for both cropToGeography and countriesToGeography: simplify to fit the engine's
 *  caps, then project into board space. `crop` is stored on the result as cartography provenance
 *  regardless of whether it came from a drawn rectangle or a selected-countries union bbox. */
function finalizeGeography(rings: readonly Ring[], crop: CropBBox): CropResult {
  const { rings: simplified, droppedRings } = simplifyToFit(rings, {
    startTolerance: startToleranceFor(crop),
    maxVertices: 8000,
    maxRings: 200,
  });
  const { baseView, project } = buildProjection(crop);
  const land = simplified.map((ring) => ring.map(([lon, lat]) => project(lon, lat)));
  return { geography: { baseView, land, crop }, droppedRings };
}

/** Full crop pipeline: clip the world to the bbox, simplify to fit the engine's caps
 *  (validateGeography's limits), then project into board space. Null on an invalid crop. */
export function cropToGeography(crop: CropBBox): CropResult | null {
  if (!isValidCrop(crop)) return null;
  const clipped = clipRingsToBBox(WORLD_LAND_DETAILED, crop);
  return finalizeGeography(clipped, crop);
}

/** Taiwan gets the same detailed-silhouette splice here that WORLD_LAND_DETAILED applies for crop
 *  mode — worldCountries.ts's own 'TWN' entry only carries Natural Earth's crude admin-0 ring. */
function ringsForCountry(country: CountryLand): readonly Ring[] {
  return country.id === 'TWN' ? taiwanRings() : country.rings;
}

/** The lon/lat bounding box of a set of rings, or null for an empty input. */
function boundsOfRings(rings: readonly Ring[]): CropBBox | null {
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

/**
 * Turn a set of selected country ids into a MapGeography, mirroring cropToGeography but sourcing
 * rings directly from the selected countries — never clipping against WORLD_LAND — so picking
 * "France" can't drag in Belgium just because it falls inside the union bounding box. Null for an
 * empty/all-unmatched selection, or one whose union bbox isValidCrop still rejects.
 */
export function countriesToGeography(ids: readonly string[]): CropResult | null {
  const idSet = new Set(ids);
  const rings = WORLD_COUNTRIES.filter((c) => idSet.has(c.id)).flatMap(ringsForCountry);
  const bbox = boundsOfRings(rings);
  if (!bbox || !isValidCrop(bbox)) return null;
  return finalizeGeography(rings, bbox);
}
```

- [ ] **Step 4: Run the tests again to confirm everything passes**

Run: `yarn workspace @trm/web test --run geo/world.test`
Expected: PASS — all `cropToGeography` and `countriesToGeography` tests green.

- [ ] **Step 5: Run the Taiwan-specific test file too (it also imports `cropToGeography` from this module)**

Run: `yarn workspace @trm/web test --run geo/taiwan.test`
Expected: PASS — unaffected by the refactor (same external behavior).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/geo/world.ts apps/web/src/features/builder/geo/world.test.ts
git commit -m "feat(web): add countriesToGeography for the map builder's country-select mode"
```

---

### Task 4: Extract `CropDrawStage.tsx` from `CropStage.tsx` (pure move) and add its first tests

**Files:**
- Modify: `apps/web/src/vitest.setup.ts` (add a `setPointerCapture` jsdom stub)
- Create: `apps/web/src/features/builder/editor/stages/CropDrawStage.tsx` (moved content, renamed export)
- Create: `apps/web/src/features/builder/editor/stages/CropDrawStage.test.tsx`
- Modify: `apps/web/src/features/builder/editor/stages/CropStage.tsx` (temporarily becomes a re-export shim; Task 7 replaces it with the real mode-toggle shell)

**Interfaces:**
- Consumes:
  - `worldLand(): readonly Ring[]`, `cropToGeography(crop: CropBBox): CropResult | null` from `../../geo/world` (already exist, unchanged by this task).
  - `clientToBoardPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null` from `../canvasProjection` (existing, unchanged).
  - `useEditorStore` from `../store`: `.draft.geography?: MapGeography`, `.setGeography(geography: MapGeography): void`, `.setStage(stage: Stage): void` where `Stage` includes `'crop' | 'trim' | ...` (existing).
- Produces: `export function CropDrawStage(): JSX.Element` — same JSX/behavior `CropStage` has today, just renamed. Task 7 imports this as `import { CropDrawStage } from './CropDrawStage'`.

- [ ] **Step 1: Add a jsdom `setPointerCapture` stub (needed to test pointer-drag interactions at all)**

`apps/web/src/vitest.setup.ts` today ends with the `matchMedia` stub block. Add this after it:

```ts
// jsdom implements no Pointer Events capture API; CropDrawStage's rectangle-drag calls
// setPointerCapture on pointerdown. Stub it globally so pointer-event-driven canvas tests don't
// throw "target.setPointerCapture is not a function".
if (!('setPointerCapture' in Element.prototype)) {
  Element.prototype.setPointerCapture = (): void => {};
  Element.prototype.releasePointerCapture = (): void => {};
  Element.prototype.hasPointerCapture = (): boolean => false;
}
```

- [ ] **Step 2: Create `CropDrawStage.tsx` with today's `CropStage.tsx` content, renamed**

Create `apps/web/src/features/builder/editor/stages/CropDrawStage.tsx` with exactly the current content of `apps/web/src/features/builder/editor/stages/CropStage.tsx` (277 lines), with only this one change: rename the exported function from `CropStage` to `CropDrawStage`.

```tsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Crop } from 'lucide-react';
import { worldLand, cropToGeography } from '../../geo/world';
import { clientToBoardPoint } from '../canvasProjection';
import { CanvasControls } from '../CanvasControls';
import { ZoomVar } from '../ZoomVar';
import { useEditorStore } from '../store';

const WORLD_VIEWBOX = { x: -180, y: -90, w: 360, h: 180 };

interface CropRect {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/** Two arbitrary opposite corners being actively dragged — order-independent; `crop` below
 *  always derives the normalized min/max rect, so which point is "0" vs "1" never matters. */
interface DragPoints {
  lon0: number;
  lat0: number;
  lon1: number;
  lat1: number;
}

type Handle = 'nw' | 'ne' | 'sw' | 'se';
const HANDLES: readonly Handle[] = ['nw', 'ne', 'sw', 'se'];

function handleCorner(h: Handle, r: CropRect): { lon: number; lat: number } {
  return {
    lon: h === 'nw' || h === 'sw' ? r.lonMin : r.lonMax,
    lat: h === 'nw' || h === 'ne' ? r.latMax : r.latMin,
  };
}
function oppositeCorner(h: Handle, r: CropRect): { lon: number; lat: number } {
  const opposite: Record<Handle, Handle> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };
  return handleCorner(opposite[h], r);
}

export function CropDrawStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const setGeography = useEditorStore((s) => s.setGeography);
  const setStage = useEditorStore((s) => s.setStage);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomVarRef = useRef<HTMLDivElement | null>(null);

  const initialCrop = draft.geography?.crop;
  const [committed, setCommitted] = useState<CropRect | null>(
    initialCrop
      ? { lonMin: initialCrop.lonMin, lonMax: initialCrop.lonMax, latMin: initialCrop.latMin, latMax: initialCrop.latMax }
      : null,
  );
  const [drag, setDrag] = useState<DragPoints | null>(null);
  const [moveBase, setMoveBase] = useState<{ origin: { lon: number; lat: number }; rect: CropRect } | null>(null);

  const toLonLat = (clientX: number, clientY: number): { lon: number; lat: number } | null => {
    if (!svgRef.current) return null;
    const pt = clientToBoardPoint(svgRef.current, clientX, clientY);
    return pt ? { lon: pt.x, lat: -pt.y } : null;
  };

  // While a corner is being dragged, its live rect always wins; otherwise fall back to committed.
  const liveDragRect: CropRect | null = drag
    ? {
        lonMin: Math.min(drag.lon0, drag.lon1),
        lonMax: Math.max(drag.lon0, drag.lon1),
        latMin: Math.min(drag.lat0, drag.lat1),
        latMax: Math.max(drag.lat0, drag.lat1),
      }
    : null;
  const rect = liveDragRect ?? committed;
  const latSpan = rect ? rect.latMax - rect.latMin : 0;
  const result = rect && rect.lonMin < rect.lonMax && rect.latMin < rect.latMax ? cropToGeography(rect) : null;

  // Left-click is never used for panning here (that's middle-click, see below), so a left-drag
  // starting on open water/land always begins a brand new rectangle — replacing any existing one.
  const startFreehand = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toLonLat(e.clientX, e.clientY);
    if (!p) return;
    setDrag({ lon0: p.lon, lat0: p.lat, lon1: p.lon, lat1: p.lat });
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag) {
      const p = toLonLat(e.clientX, e.clientY);
      if (p) setDrag({ ...drag, lon1: p.lon, lat1: p.lat });
      return;
    }
    if (moveBase) {
      const p = toLonLat(e.clientX, e.clientY);
      if (!p) return;
      const dLon = p.lon - moveBase.origin.lon;
      const dLat = p.lat - moveBase.origin.lat;
      setCommitted({
        lonMin: moveBase.rect.lonMin + dLon,
        lonMax: moveBase.rect.lonMax + dLon,
        latMin: moveBase.rect.latMin + dLat,
        latMax: moveBase.rect.latMax + dLat,
      });
    }
  };
  const onSvgPointerUp = () => {
    if (drag) {
      setCommitted({
        lonMin: Math.min(drag.lon0, drag.lon1),
        lonMax: Math.max(drag.lon0, drag.lon1),
        latMin: Math.min(drag.lat0, drag.lat1),
        latMax: Math.max(drag.lat0, drag.lat1),
      });
      setDrag(null);
    }
    setMoveBase(null);
  };

  const startHandleDrag = (h: Handle) => (e: React.PointerEvent<SVGRectElement>) => {
    e.stopPropagation();
    if (!committed) return;
    const anchor = oppositeCorner(h, committed);
    const moving = handleCorner(h, committed);
    setDrag({ lon0: anchor.lon, lat0: anchor.lat, lon1: moving.lon, lat1: moving.lat });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const startBodyMove = (e: React.PointerEvent<SVGRectElement>) => {
    e.stopPropagation();
    if (!committed) return;
    const p = toLonLat(e.clientX, e.clientY);
    if (!p) return;
    setMoveBase({ origin: p, rect: committed });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const startOver = () => {
    setCommitted(null);
    setDrag(null);
    setMoveBase(null);
  };

  const confirm = () => {
    if (!result) return;
    setGeography(result.geography);
    setStage('trim');
  };

  const hint = committed ? t('builder.cropAdjustHint') : t('builder.cropDrawHint');

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <div className="editor-canvas-inner" ref={zoomVarRef}>
          <TransformWrapper
            minScale={1}
            maxScale={64}
            initialScale={1}
            centerOnInit
            wheel={{ step: 0.0022 }}
            doubleClick={{ disabled: true }}
            // Left-click is reserved for drawing/adjusting the crop rectangle (see startFreehand);
            // panning uses the middle mouse button instead, unlike the live board's left-drag pan.
            panning={{ allowLeftClickPan: false, allowMiddleClickPan: true }}
          >
            <ZoomVar targetRef={zoomVarRef} />
            <CanvasControls />
            {/* contentStyle overrides the library's default `width/height: fit-content` on the
                inner content div — without it the SVG's own 100%/100% resolves against an
                indefinite parent and falls back to its tiny intrinsic size, so the world map
                never actually fills (or grows with) the viewport. */}
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: '100%', height: '100%' }}
            >
              <svg
                ref={svgRef}
                className="board editor-world"
                viewBox={`${WORLD_VIEWBOX.x} ${WORLD_VIEWBOX.y} ${WORLD_VIEWBOX.w} ${WORLD_VIEWBOX.h}`}
                role="img"
                aria-label={t('builder.cropWorld')}
                onPointerDown={startFreehand}
                onPointerMove={onSvgPointerMove}
                onPointerUp={onSvgPointerUp}
              >
                <rect x={-180} y={-90} width={360} height={180} className="editor-world-sea" />
                <g className="editor-world-graticule">
                  {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => (
                    <line key={`gx${lon}`} x1={lon} y1={-90} x2={lon} y2={90} />
                  ))}
                  {[-60, -30, 0, 30, 60].map((lat) => (
                    <line key={`gy${lat}`} x1={-180} y1={-lat} x2={180} y2={-lat} />
                  ))}
                </g>
                {worldLand().map((ring, i) => (
                  <path
                    key={i}
                    d={`M ${ring.map(([lon, lat]) => `${lon},${-lat}`).join(' L ')} Z`}
                    className="editor-world-land"
                  />
                ))}
                {rect && (
                  <g className="editor-crop-group">
                    <rect
                      x={rect.lonMin}
                      y={-rect.latMax}
                      width={rect.lonMax - rect.lonMin}
                      height={rect.latMax - rect.latMin}
                      className="editor-crop-rect"
                      onPointerDown={startBodyMove}
                    />
                    {HANDLES.map((h) => {
                      const c = handleCorner(h, rect);
                      return (
                        <rect
                          key={h}
                          x={c.lon}
                          y={-c.lat}
                          className={`editor-crop-handle editor-crop-handle-${h}`}
                          onPointerDown={startHandleDrag(h)}
                        />
                      );
                    })}
                  </g>
                )}
              </svg>
            </TransformComponent>
          </TransformWrapper>
        </div>
        <p className="muted editor-hint">{hint}</p>
        {latSpan > 60 && <p className="error editor-hint editor-hint--warning">{t('builder.cropLatWarning')}</p>}
      </div>
      <aside className="card stack editor-inspector">
        <h3>{t('builder.cropPreview')}</h3>
        {result ? (
          <>
            <svg
              viewBox={`${result.geography.baseView.x} ${result.geography.baseView.y} ${result.geography.baseView.w} ${result.geography.baseView.h}`}
              className="editor-crop-preview-svg"
              role="img"
              aria-label={t('builder.cropPreview')}
            >
              <rect
                x={result.geography.baseView.x}
                y={result.geography.baseView.y}
                width={result.geography.baseView.w}
                height={result.geography.baseView.h}
                className="editor-world-sea"
              />
              {result.geography.land.map((ring, i) => (
                <path
                  key={i}
                  d={`M ${ring.map(([x, y]) => `${x},${y}`).join(' L ')} Z`}
                  className="editor-world-land"
                />
              ))}
            </svg>
            {result.droppedRings > 0 && (
              <p className="muted">{t('builder.cropDropped', { n: result.droppedRings })}</p>
            )}
            <div className="row">
              <button className="primary" onClick={confirm}>
                {t('builder.cropConfirm')}
              </button>
              <button onClick={startOver}>
                <Crop size={14} aria-hidden /> {t('builder.cropRedo')}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{t('builder.cropEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Point `CropStage.tsx` at the moved component (temporary re-export — Task 7 replaces this)**

Replace `apps/web/src/features/builder/editor/stages/CropStage.tsx` in full:

```tsx
export { CropDrawStage as CropStage } from './CropDrawStage';
```

- [ ] **Step 4: Run the full test suite to confirm nothing else broke from the move**

Run: `yarn workspace @trm/web test --run`
Expected: PASS — every existing test still green (nothing imported `CropStage`'s internals directly; `EditorScreen.tsx`'s `import { CropStage } from './stages/CropStage'` still resolves).

- [ ] **Step 5: Write `CropDrawStage.test.tsx`**

Create `apps/web/src/features/builder/editor/stages/CropDrawStage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CropDrawStage } from './CropDrawStage';
import { useEditorStore } from '../store';

// jsdom has no getScreenCTM/createSVGPoint, so clientToBoardPoint's real SVG screen-CTM math
// can't resolve a point in tests (see StopsStage.test.tsx for the same rationale, applied there
// via a EditorCanvas mock). Stub it with an identity mapping so pointer events exercise
// CropDrawStage's own drag logic instead of silently no-op'ing.
vi.mock('../canvasProjection', () => ({
  clientToBoardPoint: (_svg: unknown, clientX: number, clientY: number) => ({ x: clientX, y: clientY }),
}));

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: { cities: [], routes: [], tickets: [] },
    revision: 0,
    shareCode: undefined,
    stage: 'crop',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

// toLonLat computes { lon: pt.x, lat: -pt.y }, and the mock above returns pt = { x: clientX, y:
// clientY } — so clientY must be negated to get the intended latitude.
function drawRect(svg: Element, lonLatFrom: [number, number], lonLatTo: [number, number]) {
  fireEvent.pointerDown(svg, { clientX: lonLatFrom[0], clientY: -lonLatFrom[1], button: 0 });
  fireEvent.pointerMove(svg, { clientX: lonLatTo[0], clientY: -lonLatTo[1] });
  fireEvent.pointerUp(svg);
}

describe('CropDrawStage', () => {
  it('shows the empty preview hint until a region is drawn', () => {
    render(<CropDrawStage />);
    expect(screen.getByText('拖曳選取一個區域以預覽')).toBeInTheDocument();
  });

  it('drawing a rectangle over Japan produces a non-empty preview', () => {
    const { container } = render(<CropDrawStage />);
    const svg = container.querySelector('svg.editor-world')!;
    drawRect(svg, [128, 30], [146, 46]);
    expect(screen.queryByText('拖曳選取一個區域以預覽')).toBeNull();
    expect(container.querySelectorAll('.editor-crop-preview-svg path').length).toBeGreaterThan(0);
  });

  it('confirm commits the geography and advances to the trim stage', () => {
    const { container } = render(<CropDrawStage />);
    const svg = container.querySelector('svg.editor-world')!;
    drawRect(svg, [128, 30], [146, 46]);
    fireEvent.click(screen.getByText('確認裁切並繼續'));
    expect(useEditorStore.getState().draft.geography).toBeDefined();
    expect(useEditorStore.getState().stage).toBe('trim');
  });

  it('redraw clears the current rectangle back to the empty hint', () => {
    const { container } = render(<CropDrawStage />);
    const svg = container.querySelector('svg.editor-world')!;
    drawRect(svg, [128, 30], [146, 46]);
    fireEvent.click(screen.getByText('重新框選'));
    expect(screen.getByText('拖曳選取一個區域以預覽')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the new test file**

Run: `yarn workspace @trm/web test --run CropDrawStage`
Expected: PASS — all 4 tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/vitest.setup.ts apps/web/src/features/builder/editor/stages/CropDrawStage.tsx apps/web/src/features/builder/editor/stages/CropDrawStage.test.tsx apps/web/src/features/builder/editor/stages/CropStage.tsx
git commit -m "refactor(web): extract CropDrawStage from CropStage ahead of the mode toggle"
```

---

### Task 5: `CountryList.tsx` — searchable, continent-grouped sidebar

**Files:**
- Modify: `apps/web/src/i18n/index.ts` (zh-Hant block ~line 319, en block ~line 747 — see exact anchors below)
- Create: `apps/web/src/features/builder/editor/stages/CountryList.tsx`
- Create: `apps/web/src/features/builder/editor/stages/CountryList.test.tsx`
- Modify: `apps/web/src/styles/builder.css` (append new rules after the existing `.editor-crop-preview-svg` block, ~line 341)

**Interfaces:**
- Consumes: `WORLD_COUNTRIES: readonly CountryLand[]` where `CountryLand = { id: string; nameEn: string; nameZh: string; continent: string; rings: readonly Ring[] }` from `../../geo/worldCountries` (Task 2).
- Produces:
  ```ts
  export interface CountryListProps {
    selected: ReadonlySet<string>;
    onToggle(id: string): void;
  }
  export function CountryList(props: CountryListProps): JSX.Element;
  ```
  Task 6's `CountryPickStage` renders `<CountryList selected={...} onToggle={...} />`.

- [ ] **Step 1: Add i18n keys**

In `apps/web/src/i18n/index.ts`, find this line in the zh-Hant block (~line 319):

```ts
        cropRedo: '重新框選',
```

Insert immediately after it:

```ts
        countrySearchPlaceholder: '搜尋國家…',
        continentAfrica: '非洲',
        continentAsia: '亞洲',
        continentEurope: '歐洲',
        continentNorthAmerica: '北美洲',
        continentSouthAmerica: '南美洲',
        continentOceania: '大洋洲',
```

Find the matching line in the en block (~line 747):

```ts
        cropRedo: 'Redraw region',
```

Insert immediately after it:

```ts
        countrySearchPlaceholder: 'Search countries…',
        continentAfrica: 'Africa',
        continentAsia: 'Asia',
        continentEurope: 'Europe',
        continentNorthAmerica: 'North America',
        continentSouthAmerica: 'South America',
        continentOceania: 'Oceania',
```

(Task 6 and Task 7 add the remaining keys this feature needs — `countrySelectedCount`, `countryPickEmptyHint`, `countryPreviewEmptyHint`, `countryLonWarning`, `cropModeToggle`, `cropModeDraw`, `cropModeCountries` — right next to where each is first used, rather than all at once here.)

- [ ] **Step 2: Add CSS for the country path highlight and list rows**

In `apps/web/src/styles/builder.css`, after the existing block ending in `.editor-crop-preview-svg { ... }` (~line 341), append:

```css
/* ── Country-pick mode (Crop stage's second on-ramp) ────────────────────────────────────── */
.editor-country {
  fill: var(--tr-land);
  stroke: var(--tr-coast);
  stroke-width: calc(0.35px * var(--inv-scale, 1));
  cursor: pointer;
}
.editor-country--selected {
  fill: color-mix(in srgb, var(--tr-ember) 45%, var(--tr-land));
  stroke: var(--tr-ember);
  stroke-width: calc(0.7px * var(--inv-scale, 1));
}
.editor-country-pick {
  /* Country paths carry their own pointer cursor; no rectangle-drawing crosshair here. */
  cursor: default;
}
.country-list-search {
  width: 100%;
}
.country-list-continent {
  margin: var(--tr-space-2) 0 var(--tr-space-1);
  font-size: 0.85em;
  color: var(--tr-ink-soft);
}
.country-list-row {
  display: flex;
  align-items: center;
  gap: var(--tr-space-1);
  padding: 2px 0;
  cursor: pointer;
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/web/src/features/builder/editor/stages/CountryList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CountryList } from './CountryList';

describe('CountryList', () => {
  it('renders countries grouped under their continent, bilingual name', () => {
    render(<CountryList selected={new Set()} onToggle={() => {}} />);
    expect(screen.getByText('亞洲')).toBeInTheDocument();
    expect(screen.getByText('日本')).toBeInTheDocument();
    expect(screen.getByText('(Japan)')).toBeInTheDocument();
  });

  it('checks the box for an already-selected country', () => {
    render(<CountryList selected={new Set(['JPN'])} onToggle={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /Japan/i })).toBeChecked();
  });

  it('calls onToggle with the clicked country id', () => {
    const onToggle = vi.fn();
    render(<CountryList selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Japan/i }));
    expect(onToggle).toHaveBeenCalledWith('JPN');
  });

  it('filters the list by search text (English name)', () => {
    render(<CountryList selected={new Set()} onToggle={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('搜尋國家…'), { target: { value: 'Japan' } });
    expect(screen.getByText('日本')).toBeInTheDocument();
    expect(screen.queryByText('法國')).toBeNull();
  });

  it('filters the list by search text (Chinese name)', () => {
    render(<CountryList selected={new Set()} onToggle={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('搜尋國家…'), { target: { value: '法國' } });
    expect(screen.getByText('法國')).toBeInTheDocument();
    expect(screen.queryByText('日本')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `yarn workspace @trm/web test --run CountryList`
Expected: FAIL with a module-not-found error (`./CountryList` doesn't exist yet).

- [ ] **Step 5: Implement `CountryList.tsx`**

Create `apps/web/src/features/builder/editor/stages/CountryList.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WORLD_COUNTRIES, type CountryLand } from '../../geo/worldCountries';

const CONTINENT_KEY: Record<string, string> = {
  Africa: 'builder.continentAfrica',
  Asia: 'builder.continentAsia',
  Europe: 'builder.continentEurope',
  'North America': 'builder.continentNorthAmerica',
  'South America': 'builder.continentSouthAmerica',
  Oceania: 'builder.continentOceania',
};
const CONTINENT_ORDER = Object.keys(CONTINENT_KEY);

export interface CountryListProps {
  selected: ReadonlySet<string>;
  onToggle(id: string): void;
}

/** Searchable, continent-grouped country picker — the precision on-ramp for CountryPickStage's
 *  map click, for countries too small to reliably click at world-map zoom. Countries within each
 *  continent are already alphabetical by English name (WORLD_COUNTRIES is generated sorted that
 *  way), so no further sort is needed here. */
export function CountryList({ selected, onToggle }: CountryListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? WORLD_COUNTRIES.filter(
          (c) => c.nameZh.includes(query.trim()) || c.nameEn.toLowerCase().includes(q) || c.id.toLowerCase() === q,
        )
      : WORLD_COUNTRIES;
    const byContinent = new Map<string, CountryLand[]>();
    for (const c of matches) {
      const list = byContinent.get(c.continent) ?? [];
      list.push(c);
      byContinent.set(c.continent, list);
    }
    return CONTINENT_ORDER.map((continent) => ({ continent, countries: byContinent.get(continent) ?? [] })).filter(
      (g) => g.countries.length > 0,
    );
  }, [query]);

  return (
    <div className="country-list stack">
      <input
        type="text"
        className="country-list-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('builder.countrySearchPlaceholder')}
        aria-label={t('builder.countrySearchPlaceholder')}
      />
      <div className="country-list-groups">
        {groups.map(({ continent, countries }) => (
          <div key={continent} className="country-list-group">
            <h4 className="country-list-continent">{t(CONTINENT_KEY[continent]!)}</h4>
            {countries.map((c) => (
              <label key={c.id} className="country-list-row">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} />
                {c.nameZh} <span className="muted">({c.nameEn})</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the test again to confirm it passes**

Run: `yarn workspace @trm/web test --run CountryList`
Expected: PASS — all 5 tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/i18n/index.ts apps/web/src/styles/builder.css apps/web/src/features/builder/editor/stages/CountryList.tsx apps/web/src/features/builder/editor/stages/CountryList.test.tsx
git commit -m "feat(web): add the searchable continent-grouped country list"
```

---

### Task 6: `CountryPickStage.tsx` — the clickable world map + confirm flow

**Files:**
- Modify: `apps/web/src/i18n/index.ts` (zh-Hant block, en block — new keys, exact anchors below)
- Create: `apps/web/src/features/builder/editor/stages/CountryPickStage.tsx`
- Create: `apps/web/src/features/builder/editor/stages/CountryPickStage.test.tsx`

**Interfaces:**
- Consumes:
  - `WORLD_COUNTRIES: readonly CountryLand[]` from `../../geo/worldCountries` (Task 2).
  - `countriesToGeography(ids: readonly string[]): CropResult | null` from `../../geo/world` (Task 3), where `CropResult = { geography: MapGeography; droppedRings: number }` and `MapGeography = { baseView: { x, y, w, h }; land: readonly (readonly [number, number])[][]; crop: { lonMin, lonMax, latMin, latMax } }`.
  - `CountryList` from `./CountryList` (Task 5): `<CountryList selected={ReadonlySet<string>} onToggle={(id: string) => void} />`.
  - `CanvasControls` from `../CanvasControls`, `ZoomVar` from `../ZoomVar` (existing, already used identically in `CropDrawStage.tsx`).
  - `useEditorStore` from `../store`: `.setGeography(geography: MapGeography): void`, `.setStage(stage: Stage): void` (existing).
- Produces: `export function CountryPickStage(): JSX.Element`. Task 7's `CropStage.tsx` imports this as `import { CountryPickStage } from './CountryPickStage'`.

- [ ] **Step 1: Add the remaining i18n keys this stage needs**

In `apps/web/src/i18n/index.ts`, zh-Hant block, immediately after the `continentOceania: '大洋洲',` line added in Task 5, insert:

```ts
        countrySelectedCount: '已選取 {{n}} 個國家',
        countryPickEmptyHint: '點擊地圖或從列表中選擇國家',
        countryPreviewEmptyHint: '選擇至少一個國家以預覽',
        countryLonWarning: '經度範圍過大，投影會失真',
```

In the en block, immediately after the `continentOceania: 'Oceania',` line added in Task 5, insert:

```ts
        countrySelectedCount: '{{n}} countries selected',
        countryPickEmptyHint: 'Click the map or pick from the list',
        countryPreviewEmptyHint: 'Select at least one country to preview',
        countryLonWarning: 'Longitude range too wide, projection will distort',
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/features/builder/editor/stages/CountryPickStage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CountryPickStage } from './CountryPickStage';
import { useEditorStore } from '../store';

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: { cities: [], routes: [], tickets: [] },
    revision: 0,
    shareCode: undefined,
    stage: 'crop',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

describe('CountryPickStage', () => {
  it('shows the empty preview hint with nothing selected', () => {
    render(<CountryPickStage />);
    expect(screen.getByText('選擇至少一個國家以預覽')).toBeInTheDocument();
  });

  it('clicking a country path on the map selects it and updates the preview', () => {
    const { container } = render(<CountryPickStage />);
    const japan = container.querySelector('[data-country-id="JPN"]')!;
    fireEvent.click(japan);
    expect(japan).toHaveClass('editor-country--selected');
    expect(screen.getByText('已選取 1 個國家')).toBeInTheDocument();
    expect(container.querySelectorAll('.editor-crop-preview-svg path').length).toBeGreaterThan(0);
  });

  it('a map click and the sidebar checkbox toggle the same selection', () => {
    const { container } = render(<CountryPickStage />);
    const checkbox = screen.getByRole('checkbox', { name: /Japan/i });
    fireEvent.click(checkbox);
    const japanPath = container.querySelector('[data-country-id="JPN"]')!;
    expect(japanPath).toHaveClass('editor-country--selected');

    fireEvent.click(japanPath);
    expect(checkbox).not.toBeChecked();
  });

  it('confirm commits the combined geography and advances to the trim stage', () => {
    const { container } = render(<CountryPickStage />);
    fireEvent.click(container.querySelector('[data-country-id="JPN"]')!);
    fireEvent.click(screen.getByText('確認裁切並繼續'));
    expect(useEditorStore.getState().draft.geography).toBeDefined();
    expect(useEditorStore.getState().stage).toBe('trim');
  });

  it('warns when the combined selection spans an unreasonably wide longitude range', () => {
    const { container } = render(<CountryPickStage />);
    // Canada (North America) + Russia (Europe/Asia border) — union bbox spans well over 120°
    // of longitude (Russia's own Natural Earth polygon already spans the full -180..180 due to
    // the antimeridian, so this also covers that pre-existing, accepted limitation).
    fireEvent.click(container.querySelector('[data-country-id="CAN"]')!);
    fireEvent.click(container.querySelector('[data-country-id="RUS"]')!);
    expect(screen.getByText('經度範圍過大，投影會失真')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `yarn workspace @trm/web test --run CountryPickStage`
Expected: FAIL with a module-not-found error (`./CountryPickStage` doesn't exist yet).

- [ ] **Step 4: Implement `CountryPickStage.tsx`**

Create `apps/web/src/features/builder/editor/stages/CountryPickStage.tsx`:

```tsx
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { CanvasControls } from '../CanvasControls';
import { ZoomVar } from '../ZoomVar';
import { useEditorStore } from '../store';
import { WORLD_COUNTRIES } from '../../geo/worldCountries';
import { countriesToGeography } from '../../geo/world';
import { CountryList } from './CountryList';

const WORLD_VIEWBOX = { x: -180, y: -90, w: 360, h: 180 };
/** Same rationale as the existing 60°-latitude crop warning (a third of that axis's ±90° range);
 *  applied to longitude's ±180° range so a Taiwan+Brazil-style pick — mostly empty ocean between
 *  two selections — gets the same "this will distort" nudge a too-tall manual crop already gets. */
const LON_SPAN_WARNING = 120;
const LAT_SPAN_WARNING = 60;

export function CountryPickStage() {
  const { t } = useTranslation();
  const setGeography = useEditorStore((s) => s.setGeography);
  const setStage = useEditorStore((s) => s.setStage);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const zoomVarRef = useRef<HTMLDivElement | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const result = useMemo(() => (selected.size > 0 ? countriesToGeography([...selected]) : null), [selected]);
  const crop = result?.geography.crop;
  const lonSpan = crop ? crop.lonMax - crop.lonMin : 0;
  const latSpan = crop ? crop.latMax - crop.latMin : 0;

  const confirm = () => {
    if (!result) return;
    setGeography(result.geography);
    setStage('trim');
  };

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <div className="editor-canvas-inner" ref={zoomVarRef}>
          <TransformWrapper
            minScale={1}
            maxScale={64}
            initialScale={1}
            centerOnInit
            wheel={{ step: 0.0022 }}
            doubleClick={{ disabled: true }}
          >
            <ZoomVar targetRef={zoomVarRef} />
            <CanvasControls />
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: '100%', height: '100%' }}
            >
              <svg
                className="board editor-world editor-country-pick"
                viewBox={`${WORLD_VIEWBOX.x} ${WORLD_VIEWBOX.y} ${WORLD_VIEWBOX.w} ${WORLD_VIEWBOX.h}`}
                role="img"
                aria-label={t('builder.cropWorld')}
              >
                <rect x={-180} y={-90} width={360} height={180} className="editor-world-sea" />
                {WORLD_COUNTRIES.map((c) => (
                  <path
                    key={c.id}
                    data-country-id={c.id}
                    d={c.rings.map((ring) => `M ${ring.map(([lon, lat]) => `${lon},${-lat}`).join(' L ')} Z`).join(' ')}
                    className={`editor-country${selected.has(c.id) ? ' editor-country--selected' : ''}`}
                    onClick={() => toggle(c.id)}
                  />
                ))}
              </svg>
            </TransformComponent>
          </TransformWrapper>
        </div>
        <p className="muted editor-hint">{t('builder.countryPickEmptyHint')}</p>
        {latSpan > LAT_SPAN_WARNING && (
          <p className="error editor-hint editor-hint--warning">{t('builder.cropLatWarning')}</p>
        )}
        {lonSpan > LON_SPAN_WARNING && (
          <p className="error editor-hint editor-hint--warning">{t('builder.countryLonWarning')}</p>
        )}
      </div>
      <aside className="card stack editor-inspector">
        <h3>{t('builder.cropPreview')}</h3>
        <CountryList selected={selected} onToggle={toggle} />
        {selected.size > 0 && <p className="muted">{t('builder.countrySelectedCount', { n: selected.size })}</p>}
        {result ? (
          <>
            <svg
              viewBox={`${result.geography.baseView.x} ${result.geography.baseView.y} ${result.geography.baseView.w} ${result.geography.baseView.h}`}
              className="editor-crop-preview-svg"
              role="img"
              aria-label={t('builder.cropPreview')}
            >
              <rect
                x={result.geography.baseView.x}
                y={result.geography.baseView.y}
                width={result.geography.baseView.w}
                height={result.geography.baseView.h}
                className="editor-world-sea"
              />
              {result.geography.land.map((ring, i) => (
                <path
                  key={i}
                  d={`M ${ring.map(([x, y]) => `${x},${y}`).join(' L ')} Z`}
                  className="editor-world-land"
                />
              ))}
            </svg>
            {result.droppedRings > 0 && (
              <p className="muted">{t('builder.cropDropped', { n: result.droppedRings })}</p>
            )}
            <div className="row">
              <button className="primary" onClick={confirm}>
                {t('builder.cropConfirm')}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{t('builder.countryPreviewEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Run the test again to confirm it passes**

Run: `yarn workspace @trm/web test --run CountryPickStage`
Expected: PASS — all 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/i18n/index.ts apps/web/src/features/builder/editor/stages/CountryPickStage.tsx apps/web/src/features/builder/editor/stages/CountryPickStage.test.tsx
git commit -m "feat(web): add CountryPickStage, the clickable-world-map country selector"
```

---

### Task 7: `CropStage.tsx` mode toggle — tie `CropDrawStage` and `CountryPickStage` together

**Files:**
- Modify: `apps/web/src/i18n/index.ts` (zh-Hant block, en block — final 3 keys)
- Modify: `apps/web/src/styles/builder.css` (append `.crop-stage-shell`/`.crop-stage-body`)
- Modify: `apps/web/src/features/builder/editor/stages/CropStage.tsx` (replace the Task-4 re-export shim with the real mode-toggle shell)
- Create: `apps/web/src/features/builder/editor/stages/CropStage.test.tsx`

**Interfaces:**
- Consumes:
  - `Segmented<T extends string>` from `../../../../components/ui/Segmented`: props `{ options: { value: T; label: string; icon?: LucideIcon }[]; value: T; onChange(next: T): void; ariaLabel: string }` (existing, unchanged).
  - `CropDrawStage` from `./CropDrawStage` (Task 4), `CountryPickStage` from `./CountryPickStage` (Task 6) — both zero-prop components.
- Produces: `export function CropStage(): JSX.Element` — same export name/path `EditorScreen.tsx` already imports (`import { CropStage } from './stages/CropStage'`); no changes needed there.

- [ ] **Step 1: Add the final i18n keys**

In `apps/web/src/i18n/index.ts`, zh-Hant block, immediately after the `countryLonWarning` line added in Task 6, insert:

```ts
        cropModeToggle: '裁切模式',
        cropModeDraw: '框選區域',
        cropModeCountries: '選擇國家',
```

In the en block, immediately after the `countryLonWarning` line added in Task 6, insert:

```ts
        cropModeToggle: 'Crop mode',
        cropModeDraw: 'Draw a region',
        cropModeCountries: 'Pick countries',
```

- [ ] **Step 2: Add the shell layout CSS**

In `apps/web/src/styles/builder.css`, append after the country-pick CSS block added in Task 5:

```css
.crop-stage-shell {
  display: flex;
  flex-direction: column;
  gap: var(--tr-space-2);
  height: 100%;
  min-height: 0;
}
.crop-stage-body {
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/web/src/features/builder/editor/stages/CropStage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CropStage } from './CropStage';
import { useEditorStore } from '../store';

// See CropDrawStage.test.tsx for why this stub is needed (jsdom has no getScreenCTM/createSVGPoint).
vi.mock('../canvasProjection', () => ({
  clientToBoardPoint: (_svg: unknown, clientX: number, clientY: number) => ({ x: clientX, y: clientY }),
}));

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: { cities: [], routes: [], tickets: [] },
    revision: 0,
    shareCode: undefined,
    stage: 'crop',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

function drawRect(svg: Element, lonLatFrom: [number, number], lonLatTo: [number, number]) {
  fireEvent.pointerDown(svg, { clientX: lonLatFrom[0], clientY: -lonLatFrom[1], button: 0 });
  fireEvent.pointerMove(svg, { clientX: lonLatTo[0], clientY: -lonLatTo[1] });
  fireEvent.pointerUp(svg);
}

describe('CropStage', () => {
  it('defaults to draw mode (no country search box present)', () => {
    render(<CropStage />);
    expect(screen.queryByPlaceholderText('搜尋國家…')).toBeNull();
  });

  it('switches to country-pick mode via the toggle', () => {
    render(<CropStage />);
    fireEvent.click(screen.getByText('選擇國家'));
    expect(screen.getByPlaceholderText('搜尋國家…')).toBeInTheDocument();
  });

  it('discards an in-progress draw selection when switching away and back', () => {
    const { container } = render(<CropStage />);
    const svg = container.querySelector('svg.editor-world')!;
    drawRect(svg, [128, 30], [146, 46]);
    expect(screen.queryByText('拖曳選取一個區域以預覽')).toBeNull();

    fireEvent.click(screen.getByText('選擇國家'));
    fireEvent.click(screen.getByText('框選區域'));
    expect(screen.getByText('拖曳選取一個區域以預覽')).toBeInTheDocument();
  });

  it('discards an in-progress country selection when switching away and back', () => {
    const { container } = render(<CropStage />);
    fireEvent.click(screen.getByText('選擇國家'));
    fireEvent.click(container.querySelector('[data-country-id="JPN"]')!);
    expect(screen.queryByText('選擇至少一個國家以預覽')).toBeNull();

    fireEvent.click(screen.getByText('框選區域'));
    fireEvent.click(screen.getByText('選擇國家'));
    expect(screen.getByText('選擇至少一個國家以預覽')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `yarn workspace @trm/web test --run CropStage.test`
Expected: FAIL — `CropStage.tsx` (still the Task-4 re-export shim) renders `CropDrawStage` unconditionally, so the "switches to country-pick mode" and later tests fail (no `'選擇國家'` text exists yet).

- [ ] **Step 5: Implement the real `CropStage.tsx` mode-toggle shell**

Replace `apps/web/src/features/builder/editor/stages/CropStage.tsx` in full:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '../../../../components/ui/Segmented';
import { CropDrawStage } from './CropDrawStage';
import { CountryPickStage } from './CountryPickStage';

type CropMode = 'draw' | 'countries';

/** Two on-ramps into the same draft.geography: draw a rectangle (CropDrawStage) or pick countries
 *  by click/search (CountryPickStage). Switching modes unmounts the other, discarding whatever
 *  unconfirmed selection it had — nothing commits to the store until that mode's own Confirm
 *  button runs, so there's nothing to preserve across the switch. */
export function CropStage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CropMode>('draw');

  return (
    <div className="crop-stage-shell">
      <Segmented<CropMode>
        options={[
          { value: 'draw', label: t('builder.cropModeDraw') },
          { value: 'countries', label: t('builder.cropModeCountries') },
        ]}
        value={mode}
        onChange={setMode}
        ariaLabel={t('builder.cropModeToggle')}
      />
      <div className="crop-stage-body">{mode === 'draw' ? <CropDrawStage /> : <CountryPickStage />}</div>
    </div>
  );
}
```

- [ ] **Step 6: Run the test again to confirm it passes**

Run: `yarn workspace @trm/web test --run CropStage.test`
Expected: PASS — all 4 tests green.

- [ ] **Step 7: Run the full test suite**

Run: `yarn workspace @trm/web test --run`
Expected: PASS — every test file in the project green, including `CropDrawStage.test.tsx`, `CountryList.test.tsx`, `CountryPickStage.test.tsx`, `CropStage.test.tsx`, `geo/world.test.ts`, `geo/worldCountries.test.ts`, `geo/projection.test.ts`, `geo/taiwan.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/i18n/index.ts apps/web/src/styles/builder.css apps/web/src/features/builder/editor/stages/CropStage.tsx apps/web/src/features/builder/editor/stages/CropStage.test.tsx
git commit -m "feat(web): wire the crop-mode toggle between draw and country-pick"
```

---

### Task 8: Final verification — typecheck, lint, bundle size, manual smoke test

**Files:** none (verification only).

**Interfaces:** none — this task only runs commands and inspects output.

- [ ] **Step 1: Typecheck the whole web workspace**

Run: `yarn workspace @trm/web typecheck`
Expected: exits 0, no errors.

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: exits 0, no errors (run from the repo root — it lints all workspaces including `@trm/web`).

- [ ] **Step 3: Run the full test suite one more time**

Run: `yarn workspace @trm/web test --run`
Expected: PASS, same file/test counts as Task 7 Step 7.

- [ ] **Step 4: Build and check the map-builder chunk size**

Run: `yarn workspace @trm/web build`
Expected: exits 0. Note the size of `dist/assets/EditorScreen-*.js` in the output (this is the lazy map-builder chunk `worldCountries.ts` lives in) and confirm `dist/assets/index-*.js` (the main bundle) has **not** grown compared to `main`'s current size — the new ~150 KB of country data must only show up in the `EditorScreen` chunk, never in `index`.

- [ ] **Step 5: Manual smoke test in a real browser**

Start the dev server: `yarn workspace @trm/server dev` (needs `docker compose up -d mongo` running first) in one terminal, and `yarn workspace @trm/web dev` in another. With a `mapBuilder`-featured account (or after granting yourself the feature via the maintainer dashboard), open `/maps`, create or edit a map, and on the Crop stage:

- Confirm the "框選區域" / "選擇國家" toggle appears and switches between the two canvases.
- In country mode, click a country on the map — it highlights, the preview pane updates, and its checkbox in the sidebar list becomes checked.
- Search the sidebar list for a country name in both Chinese and English and confirm it filters correctly, and that toggling its checkbox behaves the same as clicking it on the map.
- Select two widely-separated countries (e.g. Taiwan + Brazil) and confirm the longitude warning appears.
- Click Confirm and confirm it advances to the Trim stage with the expected land silhouette, exactly as the existing rectangle-crop flow already does.
- Switch back to Crop stage, confirm your prior in-progress (unconfirmed) selection in either mode is gone, matching the design's stated behavior.

If anything here doesn't match, fix it before considering this plan complete — per this project's standing rule, UI changes aren't done until manually verified in a real browser, not just via passing tests.

- [ ] **Step 6: Final commit if Step 5 required any fixes**

If Step 5 required any code changes, stage exactly those files and commit with a message describing the fix. If Step 5 needed no changes, there is nothing to commit for this task.
