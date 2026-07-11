import { describe, it, expect } from 'vitest';
import { smoothClosedPath } from '@trm/map-data';
import { MIN_SCALE, MAX_SCALE, fitTransform, smoothCoastPath } from './geography';

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
    expect(fitTransform({ cx: 10, cy: 10, w: 1, h: 1 }, { w: 1000, h: 1000 }).scale).toBe(
      MAX_SCALE,
    );
  });

  it('clamps a huge target to MIN_SCALE instead of vanishing', () => {
    expect(
      fitTransform({ cx: 5000, cy: 5000, w: 100000, h: 100000 }, { w: 800, h: 600 }).scale,
    ).toBe(MIN_SCALE);
  });
});

describe('smoothCoastPath', () => {
  // Axis-aligned, like the crop rectangle's own boundary — see the dedicated straight-edge test
  // below. Deliberately NOT used for the curve-shape tests, since every one of its edges is now
  // special-cased to render straight.
  const square: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  // A skewed quadrilateral standing in for organic coastline data: no two consecutive points share
  // an x or y, so every edge goes through the curved (non-crop-edge) path.
  const diamond: [number, number][] = [
    [0, 0],
    [3, 1],
    [4, 4],
    [1, 3],
  ];
  // Sparse and unevenly-spaced, like the Natural-Earth vertices a crop is actually built from — one
  // short hop sandwiched between two long ones. This is the exact shape of the historical "melted
  // blob" overshoot the smoother exists to tame, so it's the meaningful case to compare against the
  // untamed stock smoother on (an evenly-spaced shape barely triggers stock's overshoot either).
  const uneven: [number, number][] = [
    [0, 0],
    [10, 0.2],
    [10.1, 0.3],
    [0.1, 10],
  ];
  // All numeric tokens in a path string = the anchor + control-point coordinates the curve passes
  // through / is pulled toward. The max/min bound how far the rendered curve strays from the shape.
  const coords = (path: string): number[] => (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

  it('returns an empty string for a degenerate ring (< 3 points)', () => {
    expect(smoothCoastPath([])).toBe('');
    expect(smoothCoastPath([[0, 0]])).toBe('');
    expect(
      smoothCoastPath([
        [0, 0],
        [1, 1],
      ]),
    ).toBe('');
  });

  it('produces a closed cubic-bezier path with one curve per edge', () => {
    const d = smoothCoastPath(diamond);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(diamond.length);
  });

  it('renders a crop-boundary (axis-aligned) edge as a straight line, never a curve', () => {
    // Sutherland–Hodgman clipping only ever introduces points at a constant lon or lat, which
    // projects to a constant board x or y — exactly what `square`'s edges look like. That edge is
    // the crop rectangle the user actually drew, so it must render pixel-identical to the straight
    // lines the crop preview shows, never curved, regardless of how the neighbouring coastline
    // segments smooth.
    const d = smoothCoastPath(square);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(0);
    expect((d.match(/L/g) ?? []).length).toBe(square.length);
  });

  it('hugs the outline: overshoots far LESS than the current /6 smoother', () => {
    // The Catmull-Rom control handles push the curve past the corners. The tamed smoother's chord
    // clamp + centripetal parameterization keep that bulge small — the visible "no more blobby
    // inflated coastlines" fix. The stock smoother bulges much further outside the shape.
    const c = coords(smoothCoastPath(uneven));
    const stock = coords(smoothClosedPath(uneven));
    const bbox = { min: 0, max: 10.1 }; // uneven's own bounding box
    const overshoot = Math.max(Math.max(...c) - bbox.max, bbox.min - Math.min(...c));
    const stockOvershoot = Math.max(Math.max(...stock) - bbox.max, bbox.min - Math.min(...stock));
    expect(overshoot).toBeLessThan(stockOvershoot * 0.75);
  });

  it('is scale-relative (same shape scaled produces a proportionally scaled path)', () => {
    const big: [number, number][] = diamond.map(([x, y]) => [x * 10, y * 10]);
    const cSmall = coords(smoothCoastPath(diamond));
    const cBig = coords(smoothCoastPath(big));
    // Every coordinate scales by 10 (rounding aside), so the tamed smoothing does not degrade with
    // absolute size — no dependence on how large the selection/crop it belongs to is.
    for (let i = 0; i < cSmall.length; i++) expect(cBig[i]).toBeCloseTo(cSmall[i]! * 10, 0);
  });
});
