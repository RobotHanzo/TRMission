import { describe, it, expect } from 'vitest';
import { scrimPath, SPOT_PAD, SPOT_RADIUS } from './scrim';

describe('scrimPath', () => {
  it('with no holes is just the full-screen rect', () => {
    expect(scrimPath(100, 50, [])).toBe('M0 0 H100 V50 H0 Z');
  });
  it('appends one rounded-rect subpath per hole, padded by SPOT_PAD', () => {
    const p = scrimPath(800, 600, [{ x: 100, y: 200, w: 50, h: 40 }]);
    expect(p.startsWith('M0 0 H800 V600 H0 Z ')).toBe(true);
    // The top edge's H stops a corner radius short; the arc then lands exactly on the padded
    // right edge x + w + pad.
    const right = 100 + 50 + SPOT_PAD;
    expect(p).toContain(`H${right - SPOT_RADIUS}`);
    expect(p).toContain(`A${SPOT_RADIUS} ${SPOT_RADIUS} 0 0 1 ${right} `);
    expect((p.match(/Z/g) ?? []).length).toBe(2); // outer rect + one hole
  });
  it('clamps the corner radius on tiny holes (no self-intersecting arcs)', () => {
    expect(() => scrimPath(800, 600, [{ x: 10, y: 10, w: 2, h: 2 }])).not.toThrow();
  });
});
