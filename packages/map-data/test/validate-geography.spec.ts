import { describe, it, expect } from 'vitest';
import { validateGeography } from '../src/index';
import type { MapGeography } from '../src/index';

const VALID: MapGeography = {
  baseView: { x: -4, y: -2, w: 84, h: 98 },
  land: [
    [
      [10, 10],
      [90, 10],
      [90, 90],
      [10, 90],
    ],
    [
      [2, 2],
      [6, 2],
      [4, 6],
    ],
  ],
  crop: { lonMin: 118, lonMax: 124, latMin: 20, latMax: 26 },
};

describe('validateGeography', () => {
  it('accepts a small valid geography', () => {
    expect(validateGeography(VALID)).toEqual([]);
  });

  it('rejects a ring with fewer than 3 vertices', () => {
    const geo: MapGeography = {
      ...VALID,
      land: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    };
    expect(validateGeography(geo).some((e) => /ring/.test(e))).toBe(true);
  });

  it('rejects non-finite coordinates', () => {
    const geo: MapGeography = {
      ...VALID,
      land: [
        [
          [0, 0],
          [Number.NaN, 5],
          [10, 10],
        ],
      ],
    };
    expect(validateGeography(geo).length).toBeGreaterThan(0);
  });

  it('rejects coordinates far outside the board space', () => {
    const geo: MapGeography = {
      ...VALID,
      land: [
        [
          [0, 0],
          [900, 5],
          [10, 10],
        ],
      ],
    };
    expect(validateGeography(geo).length).toBeGreaterThan(0);
  });

  it('rejects too many rings', () => {
    const ring: readonly (readonly [number, number])[] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const geo: MapGeography = { ...VALID, land: Array.from({ length: 401 }, () => ring) };
    expect(validateGeography(geo).some((e) => /ring/.test(e))).toBe(true);
  });

  it('rejects too many total vertices', () => {
    const big: [number, number][] = Array.from({ length: 5001 }, (_, i) => [
      (i % 100) + 0.5,
      Math.floor(i / 100) + 0.5,
    ]);
    const geo: MapGeography = { ...VALID, land: [big, big, big, big] };
    expect(validateGeography(geo).some((e) => /vert/i.test(e))).toBe(true);
  });

  it('rejects a degenerate baseView', () => {
    const geo: MapGeography = { ...VALID, baseView: { x: 0, y: 0, w: 0, h: 98 } };
    expect(validateGeography(geo).some((e) => /baseView/.test(e))).toBe(true);
  });

  it('rejects an inverted crop bbox', () => {
    const geo: MapGeography = { ...VALID, crop: { lonMin: 124, lonMax: 118, latMin: 20, latMax: 26 } };
    expect(validateGeography(geo).some((e) => /crop/.test(e))).toBe(true);
  });
});
