import { describe, it, expect } from 'vitest';
import { BASE_VIEW, MAX_SCALE, homeScale } from './geography';

describe('homeScale', () => {
  // The board fills its cell, so the viewport's aspect ratio varies with window width. The
  // home/reset zoom must be the scale that makes BASE_VIEW *cover* that viewport, generalising
  // the old hard-coded 1.9 (which was exactly this cover-fit for one ~1200×760 board).
  it('reproduces the legacy ~1.84 cover-fit for the board it was tuned on', () => {
    expect(homeScale(1200, 760)).toBeCloseTo(1.842, 2);
  });

  it('is 1 when the viewport already matches the BASE_VIEW aspect ratio', () => {
    // vw/w === vh/h → nothing to cover, so scale is 1.
    expect(homeScale(BASE_VIEW.w * 10, BASE_VIEW.h * 10)).toBeCloseTo(1, 5);
  });

  it('zooms in more as the viewport gets wider (so the map never shrinks to side margins)', () => {
    expect(homeScale(1500, 760)).toBeGreaterThan(homeScale(1200, 760));
  });

  it('clamps absurd aspect ratios to the max scale instead of overscaling', () => {
    expect(homeScale(8000, 100)).toBe(MAX_SCALE);
  });

  it('falls back to a sane default when the viewport has not been measured yet', () => {
    expect(homeScale(0, 760)).toBe(1.9);
    expect(homeScale(1200, 0)).toBe(1.9);
  });
});
