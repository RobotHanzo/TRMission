import { describe, it, expect } from 'vitest';
import { buildProjection, isValidCrop } from './projection';

describe('isValidCrop', () => {
  it('accepts a sane bbox', () => {
    expect(isValidCrop({ lonMin: 129, lonMax: 132, latMin: 31, latMax: 34 })).toBe(true);
  });
  it('rejects an inverted or degenerate bbox', () => {
    expect(isValidCrop({ lonMin: 132, lonMax: 129, latMin: 31, latMax: 34 })).toBe(false);
    expect(isValidCrop({ lonMin: 129, lonMax: 129, latMin: 31, latMax: 34 })).toBe(false);
  });
  it('rejects latitudes beyond the polar clamp', () => {
    expect(isValidCrop({ lonMin: 0, lonMax: 10, latMin: -85, latMax: 10 })).toBe(false);
    expect(isValidCrop({ lonMin: 0, lonMax: 10, latMin: 0, latMax: 85 })).toBe(false);
  });

  it('accepts real-world high-latitude country extents (Greenland reaches 83.65°N)', () => {
    expect(isValidCrop({ lonMin: -73.3, lonMax: -12.21, latMin: 60.04, latMax: 83.65 })).toBe(true);
    expect(isValidCrop({ lonMin: 0, lonMax: 10, latMin: 0, latMax: 84 })).toBe(true);
  });
});

describe('buildProjection', () => {
  const crop = { lonMin: 129, lonMax: 132, latMin: 31, latMax: 34 };

  it('round-trips project→unproject within rounding tolerance', () => {
    const { project, unproject } = buildProjection(crop);
    for (const [lon, lat] of [
      [129.5, 31.5],
      [130.8, 33.1],
      [131.9, 33.9],
    ] as const) {
      const [x, y] = project(lon, lat);
      const [lon2, lat2] = unproject(x, y);
      expect(lon2).toBeCloseTo(lon, 1);
      expect(lat2).toBeCloseTo(lat, 1);
    }
  });

  it('places north at smaller y and west at smaller x (board convention)', () => {
    const { project } = buildProjection(crop);
    const [xWest] = project(crop.lonMin, 32.5);
    const [xEast] = project(crop.lonMax, 32.5);
    expect(xWest).toBeLessThan(xEast);
    const [, yNorth] = project(130.5, crop.latMax);
    const [, ySouth] = project(130.5, crop.latMin);
    expect(yNorth).toBeLessThan(ySouth);
  });

  it('keeps a ground-square crop roughly square in board space (locally aspect-true)', () => {
    // A box that is square in GROUND distance at 32.5°N needs a wider lon span than lat span
    // (lines of longitude converge toward the poles) — lonSpan = latSpan / cos(midLat).
    const midLat = 32.5;
    const latSpan = 3;
    const lonSpan = latSpan / Math.cos((midLat * Math.PI) / 180);
    const squareCrop = { lonMin: 129, lonMax: 129 + lonSpan, latMin: 31, latMax: 34 };
    const { project, baseView } = buildProjection(squareCrop);
    const [x0, y0] = project(squareCrop.lonMin, squareCrop.latMax);
    const [x1, y1] = project(squareCrop.lonMax, squareCrop.latMin);
    const w = x1 - x0;
    const h = y1 - y0;
    expect(Math.abs(w - h) / Math.max(w, h)).toBeLessThan(0.02);
    // The whole projected box must sit inside the returned baseView (plus its own margin).
    expect(x0).toBeGreaterThanOrEqual(baseView.x);
    expect(x1).toBeLessThanOrEqual(baseView.x + baseView.w);
  });

  it('rounds projected coordinates to 2 decimals (hash stability)', () => {
    const { project } = buildProjection(crop);
    const [x, y] = project(130.123456, 32.654321);
    expect(x).toBe(Math.round(x * 100) / 100);
    expect(y).toBe(Math.round(y * 100) / 100);
  });

  it('produces a wider-than-tall footprint for a wide crop, and vice versa', () => {
    const wide = buildProjection({ lonMin: 0, lonMax: 20, latMin: 0, latMax: 5 });
    const [wx0, wy0] = wide.project(0, 5);
    const [wx1, wy1] = wide.project(20, 0);
    expect(wx1 - wx0).toBeGreaterThan(wy1 - wy0);

    const tall = buildProjection({ lonMin: 0, lonMax: 5, latMin: 0, latMax: 20 });
    const [tx0, ty0] = tall.project(0, 20);
    const [tx1, ty1] = tall.project(5, 0);
    expect(ty1 - ty0).toBeGreaterThan(tx1 - tx0);
  });
});
