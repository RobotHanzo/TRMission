import { describe, it, expect } from 'vitest';
import { clipRingToBBox, clipRingsToBBox, type Ring } from './clip';

const bbox = { lonMin: 0, lonMax: 10, latMin: 0, latMax: 10 };

describe('clipRingToBBox', () => {
  it('returns the ring unchanged when it is entirely inside the box', () => {
    const ring: Ring = [
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
    ];
    expect(clipRingToBBox(ring, bbox)).toEqual([ring]);
  });

  it('returns empty when the ring is entirely outside the box', () => {
    const ring: Ring = [
      [20, 20],
      [30, 20],
      [30, 30],
      [20, 30],
    ];
    expect(clipRingToBBox(ring, bbox)).toEqual([]);
  });

  it('clips a ring straddling one edge, inserting the intersection points', () => {
    // A square spanning lon -5..5, lat 2..8 — clipped to lon>=0 should become lon 0..5.
    const ring: Ring = [
      [-5, 2],
      [5, 2],
      [5, 8],
      [-5, 8],
    ];
    const [clipped] = clipRingToBBox(ring, bbox);
    expect(clipped).toBeDefined();
    for (const [lon] of clipped!) expect(lon).toBeGreaterThanOrEqual(0);
    // The clipped shape still spans the same lat range and reaches lon=5 and lon=0.
    const lons = clipped!.map((p) => p[0]);
    expect(Math.max(...lons)).toBeCloseTo(5);
    expect(Math.min(...lons)).toBeCloseTo(0);
  });

  it('clips a ring straddling all four edges down to exactly the box', () => {
    const huge: Ring = [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ];
    const [clipped] = clipRingToBBox(huge, bbox);
    expect(clipped).toBeDefined();
    for (const [lon, lat] of clipped!) {
      expect(lon).toBeGreaterThanOrEqual(bbox.lonMin - 1e-9);
      expect(lon).toBeLessThanOrEqual(bbox.lonMax + 1e-9);
      expect(lat).toBeGreaterThanOrEqual(bbox.latMin - 1e-9);
      expect(lat).toBeLessThanOrEqual(bbox.latMax + 1e-9);
    }
    const lons = clipped!.map((p) => p[0]);
    const lats = clipped!.map((p) => p[1]);
    expect(Math.max(...lons) - Math.min(...lons)).toBeCloseTo(10);
    expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(10);
  });

  it('splits one input ring into multiple output rings when the box separates it into disjoint pieces', () => {
    // A "horseshoe" ring: two arms (well inside the box, on the left and right) joined only by a
    // base that runs entirely below latMin. This mirrors Natural Earth's Afro-Eurasia ring, where
    // a crop can contain two landmasses (e.g. Europe and North Africa) joined only by land outside
    // the crop (e.g. through the Middle East). A single-ring Sutherland-Hodgman clip can't express
    // that split and instead bridges the two pieces with a spurious edge straight across the box
    // interior — the exact "land line across open sea" bug this guards against.
    const horseshoe: Ring = [
      [1, 9],
      [1, -5], // outer left edge, down past latMin
      [9, -5], // base, entirely below latMin
      [9, 9], // outer right edge, back up
      [7, 9],
      [7, -1], // inner right edge of the notch, also dipping below latMin
      [3, -1], // inner base of the notch, also below latMin
      [3, 9], // inner left edge, back up — closes into two arms once latMin cuts the base off
    ];
    const result = clipRingToBBox(horseshoe, bbox);
    // Must NOT collapse to one ring bridging both arms across the box interior — the box must
    // report exactly two separate landmasses (the left arm and the right arm).
    expect(result).toHaveLength(2);
    for (const ring of result) {
      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThanOrEqual(bbox.lonMin - 1e-9);
        expect(lon).toBeLessThanOrEqual(bbox.lonMax + 1e-9);
        expect(lat).toBeGreaterThanOrEqual(bbox.latMin - 1e-9);
        expect(lat).toBeLessThanOrEqual(bbox.latMax + 1e-9);
      }
    }
    // Neither piece should touch the other's side of the box — confirms they're genuinely
    // disjoint rather than one ring that happens to pass the bounds check.
    const maxLonOf = (r: Ring) => Math.max(...r.map((p) => p[0]));
    const minLonOf = (r: Ring) => Math.min(...r.map((p) => p[0]));
    const [left, right] = [...result].sort((a, b) => minLonOf(a) - minLonOf(b));
    expect(maxLonOf(left!)).toBeLessThan(minLonOf(right!));
  });
});

describe('clipRingsToBBox', () => {
  it('drops rings that clip to nothing and degenerate slivers', () => {
    const inside: Ring = [
      [2, 2],
      [8, 2],
      [8, 8],
    ];
    const outside: Ring = [
      [50, 50],
      [60, 50],
      [60, 60],
    ];
    const result = clipRingsToBBox([inside, outside], bbox);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(inside);
  });
});
