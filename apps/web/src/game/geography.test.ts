import { describe, it, expect } from 'vitest';
import { MIN_SCALE, MAX_SCALE, fitTransform } from './geography';

describe('fitTransform', () => {
  // The board is tall-and-narrow inside a wide viewport, so the home/reset view fits the island
  // bounding box to the viewport (contain, minus a margin) and centres it. fitTransform is the
  // pure core: it takes the island's content-space rect (measured live) + the viewport size.
  it('scales the target to fill the constraining axis, minus the padding', () => {
    // Tall target in a wide viewport → height is the limiting axis.
    const t = fitTransform({ cx: 100, cy: 100, w: 50, h: 200 }, { w: 1000, h: 500 }, 0.9);
    expect(t.scale).toBeCloseTo((0.9 * 500) / 200, 5); // 2.25, not the looser width fit
  });

  it('centres the target in the viewport', () => {
    const vp = { w: 1000, h: 600 };
    const t = fitTransform({ cx: 120, cy: 80, w: 40, h: 100 }, vp, 0.9);
    // The target centre must map to the viewport centre: scale*c + offset === size/2.
    expect(t.scale * 120 + t.x).toBeCloseTo(vp.w / 2, 5);
    expect(t.scale * 80 + t.y).toBeCloseTo(vp.h / 2, 5);
  });

  it('clamps a tiny target to MAX_SCALE instead of zooming past the limit', () => {
    expect(fitTransform({ cx: 10, cy: 10, w: 1, h: 1 }, { w: 1000, h: 1000 }).scale).toBe(MAX_SCALE);
  });

  it('clamps a huge target to MIN_SCALE instead of vanishing', () => {
    expect(
      fitTransform({ cx: 5000, cy: 5000, w: 100000, h: 100000 }, { w: 800, h: 600 }).scale,
    ).toBe(MIN_SCALE);
  });
});
