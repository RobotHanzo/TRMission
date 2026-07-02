import { describe, it, expect } from 'vitest';
import { validateGeography } from '@trm/map-data';
import { isCrudeTaiwanRing, taiwanRings } from './taiwan';
import { WORLD_LAND } from './worldData';
import { cropToGeography } from './world';

describe('isCrudeTaiwanRing', () => {
  it('identifies the Natural Earth Taiwan blob and nothing else', () => {
    const matches = WORLD_LAND.filter(isCrudeTaiwanRing);
    expect(matches.length).toBe(1);
  });
});

describe('taiwanRings', () => {
  it('produces a densified main island plus nine outlying islands', () => {
    const rings = taiwanRings();
    expect(rings.length).toBe(10);
    const [main, ...islands] = rings;
    expect(main!.length).toBeGreaterThan(28);
    for (const ring of islands) expect(ring.length).toBeGreaterThanOrEqual(12);
  });

  it('places the main island inside real Taiwan lon/lat bounds', () => {
    const [main] = taiwanRings();
    for (const [lon, lat] of main!) {
      expect(lon).toBeGreaterThan(119.5);
      expect(lon).toBeLessThan(122.5);
      expect(lat).toBeGreaterThan(21.5);
      expect(lat).toBeLessThan(25.5);
    }
  });
});

describe('cropToGeography around Taiwan', () => {
  it('yields the detailed silhouette, not the 4-point Natural Earth blob', () => {
    const result = cropToGeography({ lonMin: 118, lonMax: 123, latMin: 21, latMax: 26 });
    expect(result).not.toBeNull();
    const { geography } = result!;
    // Some rings this bbox also touches (e.g. slivers of neighbouring landmasses clipped down to
    // a corner) legitimately drop below the 3-vertex floor — that's unrelated to the Taiwan splice.
    // What matters here: the main island itself survives dense, not as the old 4-point blob.
    // simplifyToFit's Douglas-Peucker pass thins the dense sample back down for storage, but a
    // real coastline still needs far more than the original blob's 4 points to hold its shape.
    const main = geography.land.reduce((a, b) => (b.length > a.length ? b : a));
    expect(main.length).toBeGreaterThan(10);
    expect(validateGeography(geography)).toEqual([]);
  });

  it('keeps the small outlying islands on a tight crop, not just the main island', () => {
    // A crop hugging just Taiwan itself (no China/Japan/Philippines fragments this time) — every
    // island here is fully inside the bbox, so any that vanish were lost to over-aggressive
    // simplification, not clipping.
    const result = cropToGeography({ lonMin: 117.8, lonMax: 122.6, latMin: 21.6, latMax: 26.5 });
    expect(result).not.toBeNull();
    const { geography } = result!;
    // 1 main island + 9 outlying (Penghu x3, Kinmen, Matsu x2, Liuqiu, Green Island, Orchid
    // Island) — this bbox may also catch a sliver of a neighbouring Natural Earth landmass, so
    // assert a floor rather than an exact count.
    expect(geography.land.length).toBeGreaterThanOrEqual(10);
    expect(validateGeography(geography)).toEqual([]);
  });

  it('keeps a small outlying island even on a crop tight enough to exclude the mainland', () => {
    // Zoomed in on Matsu alone (the smallest island, r=0.7 board units) — the previous fixed
    // 0.05° starting tolerance was itself larger than this island's radius and collapsed it to
    // under 3 points regardless of crop size; the tolerance must scale down with the crop span.
    const result = cropToGeography({ lonMin: 119.8, lonMax: 120.2, latMin: 26.0, latMax: 26.4 });
    expect(result).not.toBeNull();
    const { geography } = result!;
    expect(geography.land.length).toBeGreaterThan(0);
    expect(validateGeography(geography)).toEqual([]);
  });
});
