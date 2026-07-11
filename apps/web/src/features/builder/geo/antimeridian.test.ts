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
