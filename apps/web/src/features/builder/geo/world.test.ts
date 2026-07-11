import { describe, it, expect } from 'vitest';
import { validateGeography } from '@trm/map-data';
import { cropToGeography, countriesToGeography, dissolveCountryRings, startToleranceFor } from './world';
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
});

describe('countriesToGeography', () => {
  it('dissolves touching or overlapping country polygons into one landmass', () => {
    const rings = dissolveCountryRings([
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      [
        [1, 0],
        [3, 0],
        [3, 2],
        [1, 2],
      ],
    ]);

    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });

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

  it('removes the internal border between neighbouring selected countries', () => {
    const selected = WORLD_COUNTRIES.filter((country) => ['FRA', 'DEU'].includes(country.id));
    const inputRingCount = selected.reduce((sum, country) => sum + country.rings.length, 0);
    const result = countriesToGeography(selected.map((country) => country.id));

    expect(result).not.toBeNull();
    expect(result!.geography.land.length).toBeLessThan(inputRingCount);
    expect(validateGeography(result!.geography)).toEqual([]);
  });

  it('excludes a neighbour that falls inside the union bbox but was not selected', () => {
    const picked = countriesToGeography(['FRA', 'DEU']);
    expect(picked).not.toBeNull();
    // France + Germany's combined bounding box spans far wider than Western Europe: France's own
    // WORLD_COUNTRIES entry includes a French Guiana ring (lon ≈ -54°), which stretches the union
    // bbox to transatlantic scale. A rectangular crop over that same box therefore also picks up
    // unrelated West African coastline, Atlantic islands, and South American coastline that the
    // two-country selection correctly excludes — so it must produce strictly more land rings.
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
});

describe('startToleranceFor', () => {
  // The simplification tolerance used to scale with the crop's span (finer for a small crop, up to
  // a 0.05° ceiling for a wide one). That coupled coastline quality to selection size — the bigger
  // the pick, the coarser the coast — which is the "geography degradation as selection enlarges"
  // this guards against. The world's own 0.03°-sourced land fits the vertex budget whole, so the
  // tolerance is now a fixed, size-independent value.
  it('is independent of crop size, so enlarging a selection cannot degrade its geography', () => {
    const tiny = { lonMin: 120, lonMax: 121, latMin: 23, latMax: 24 };
    const huge = { lonMin: -170, lonMax: 170, latMin: -80, latMax: 80 };
    expect(startToleranceFor(tiny)).toBe(startToleranceFor(huge));
  });

  it('stays fine enough to preserve the source data (≤ its 0.03° resolution) and positive', () => {
    const anyCrop = { lonMin: 0, lonMax: 40, latMin: 0, latMax: 40 };
    // Positive so simplifyToFit's over-budget safety net can still raise it; ≤ 0.03° so it never
    // strips detail the vendored source already carries.
    expect(startToleranceFor(anyCrop)).toBeGreaterThan(0);
    expect(startToleranceFor(anyCrop)).toBeLessThanOrEqual(0.03);
  });
});
