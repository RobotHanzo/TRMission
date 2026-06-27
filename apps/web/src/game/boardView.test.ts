import { describe, it, expect } from 'vitest';
import { transformToView, viewToTransform, type BoardTransform } from './boardView';

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

describe('boardView — local transform ⇄ board-space view descriptor', () => {
  it('round-trips a transform back to itself (no information lost)', () => {
    const W = 1200;
    const H = 760;
    const t: BoardTransform = { positionX: -240, positionY: -130, scale: 2.4 };
    const view = transformToView(t, W, H);
    const back = viewToTransform(view, W, H);
    expect(close(back.positionX, t.positionX, 1e-4)).toBe(true);
    expect(close(back.positionY, t.positionY, 1e-4)).toBe(true);
    expect(close(back.scale, t.scale, 1e-4)).toBe(true);
  });

  it('is screen-size independent: one descriptor frames the SAME view on any window', () => {
    // The descriptor is what travels on the wire; each viewer reconstructs its own
    // transform. transformToView(viewToTransform(view)) must be the identity for ANY size.
    const view = { cx: 40, cy: 52, span: 28 };
    for (const [W, H] of [
      [1200, 760],
      [800, 1200], // portrait — different aspect ratio
      [1920, 1080],
    ] as const) {
      const round = transformToView(viewToTransform(view, W, H), W, H);
      expect(close(round.cx, view.cx, 1e-4), `cx @ ${W}x${H}`).toBe(true);
      expect(close(round.cy, view.cy, 1e-4), `cy @ ${W}x${H}`).toBe(true);
      expect(close(round.span, view.span, 1e-4), `span @ ${W}x${H}`).toBe(true);
    }
  });

  it('places the descriptor centre at the viewport centre', () => {
    const W = 1000;
    const H = 800;
    const view = { cx: 30, cy: 70, span: 20 };
    const t = viewToTransform(view, W, H);
    // Re-deriving the board point under the viewport centre must return (cx, cy).
    const centre = transformToView(t, W, H);
    expect(close(centre.cx, 30, 1e-4)).toBe(true);
    expect(close(centre.cy, 70, 1e-4)).toBe(true);
  });

  it('clamps reconstructed scale to the board pan/zoom bounds', () => {
    const W = 1200;
    const H = 760;
    // An absurdly tiny span would demand a scale far past maxScale — it must clamp.
    const tIn = viewToTransform({ cx: 40, cy: 50, span: 0.01 }, W, H);
    expect(tIn.scale).toBeLessThanOrEqual(8);
    // An absurdly large span would demand a scale below minScale — it must clamp.
    const tOut = viewToTransform({ cx: 40, cy: 50, span: 10_000 }, W, H);
    expect(tOut.scale).toBeGreaterThanOrEqual(0.8);
  });
});
