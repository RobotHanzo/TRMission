import { describe, it, expect } from 'vitest';
import {
  transformToView,
  viewToTransform,
  boardProjection,
  visibleFraction,
  type BoardTransform,
  type BoardProjection,
} from './boardView';

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

// A representative board→content-pixel projection: the uniform-scale + letterbox-offset
// shape `getCTM()` yields for the board <svg> at rzpp scale 1.
const projFor = (k: number, e = 0, f = 0): BoardProjection => ({ k, e, f });

describe('boardView — local transform ⇄ board-space view descriptor', () => {
  it('round-trips a transform back to itself (no information lost)', () => {
    const W = 1200;
    const H = 760;
    const proj = projFor(9.3, 40, -12);
    const t: BoardTransform = { positionX: -240, positionY: -130, scale: 2.4 };
    const view = transformToView(t, proj, W, H);
    const back = viewToTransform(view, proj, W, H);
    expect(close(back.positionX, t.positionX, 1e-4)).toBe(true);
    expect(close(back.positionY, t.positionY, 1e-4)).toBe(true);
    expect(close(back.scale, t.scale, 1e-4)).toBe(true);
  });

  it('is screen-size independent: one descriptor frames the SAME view on any client', () => {
    // The descriptor is what travels on the wire; each viewer reconstructs its own transform
    // through ITS OWN projection (different intrinsic content box / window size). Reconstructing
    // then re-deriving the descriptor must be the identity on every client.
    const view = { cx: 40, cy: 52, span: 28 };
    const clients = [
      { W: 1200, H: 760, proj: projFor(9.0, 30, -10) },
      { W: 800, H: 1200, proj: projFor(8.1, 5, 60) }, // portrait, different content box
      { W: 1920, H: 1080, proj: projFor(11.4, 120, 0) },
    ];
    for (const { W, H, proj } of clients) {
      const round = transformToView(viewToTransform(view, proj, W, H), proj, W, H);
      expect(close(round.cx, view.cx, 1e-4), `cx @ ${W}x${H}`).toBe(true);
      expect(close(round.cy, view.cy, 1e-4), `cy @ ${W}x${H}`).toBe(true);
      expect(close(round.span, view.span, 1e-4), `span @ ${W}x${H}`).toBe(true);
    }
  });

  it('places the descriptor centre at the viewport centre', () => {
    const W = 1000;
    const H = 800;
    const proj = projFor(8.5, 22, 14);
    const view = { cx: 30, cy: 70, span: 20 };
    const t = viewToTransform(view, proj, W, H);
    // Re-deriving the board point under the viewport centre must return (cx, cy).
    const centre = transformToView(t, proj, W, H);
    expect(close(centre.cx, 30, 1e-4)).toBe(true);
    expect(close(centre.cy, 70, 1e-4)).toBe(true);
  });

  it('clamps reconstructed scale to the board pan/zoom bounds', () => {
    const W = 1200;
    const H = 760;
    const proj = projFor(9.3);
    // An absurdly tiny span would demand a scale far past maxScale — it must clamp.
    const tIn = viewToTransform({ cx: 40, cy: 50, span: 0.01 }, proj, W, H);
    expect(tIn.scale).toBeLessThanOrEqual(8);
    // An absurdly large span would demand a scale below minScale — it must clamp.
    const tOut = viewToTransform({ cx: 40, cy: 50, span: 10_000 }, proj, W, H);
    expect(tOut.scale).toBeGreaterThanOrEqual(0.8);
  });
});

describe('boardProjection — read the board→pixel affine off the live <svg>', () => {
  it('returns null when the element or its CTM is unavailable', () => {
    expect(boardProjection(null)).toBeNull();
    expect(boardProjection(undefined)).toBeNull();
    expect(boardProjection({} as unknown as SVGSVGElement)).toBeNull();
    expect(boardProjection({ getCTM: () => null } as unknown as SVGSVGElement)).toBeNull();
  });

  it('extracts uniform scale + translation from the CTM', () => {
    const svg = {
      getCTM: () => ({ a: 9, b: 0, c: 0, d: 9, e: 30, f: -10 }),
    } as unknown as SVGSVGElement;
    expect(boardProjection(svg)).toEqual({ k: 9, e: 30, f: -10 });
  });
});

describe('visibleFraction — how much of a railway is on screen', () => {
  const W = 1000;
  const H = 800;
  const proj = projFor(10, 0, 0); // 10 px per board unit, no letterbox offset

  // Centre the view (span via scale) so board point (50,40) sits at the viewport centre.
  const centred = viewToTransform({ cx: 50, cy: 40, span: 60 }, proj, W, H);

  it('is 1 when every car sits inside the viewport', () => {
    const pts = [
      { x: 49, y: 39 },
      { x: 50, y: 40 },
      { x: 51, y: 41 },
    ];
    expect(visibleFraction(pts, centred, proj, W, H)).toBe(1);
  });

  it('is 0 when the railway is entirely off screen', () => {
    // Far to the south-east of a view centred on (50,40) with a 60-unit span.
    const pts = [
      { x: 200, y: 200 },
      { x: 210, y: 205 },
    ];
    expect(visibleFraction(pts, centred, proj, W, H)).toBe(0);
  });

  it('reports the in-view share for a half-on, half-off railway', () => {
    const pts = [
      { x: 50, y: 40 }, // centre — on screen
      { x: 51, y: 40 }, // on screen
      { x: 500, y: 40 }, // way off east — off screen
      { x: 520, y: 40 }, // off screen
    ];
    expect(visibleFraction(pts, centred, proj, W, H)).toBe(0.5);
  });

  it('is 0 for an empty point set', () => {
    expect(visibleFraction([], centred, proj, W, H)).toBe(0);
  });
});
