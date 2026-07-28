import { describe, it, expect } from 'vitest';
import { clientToBoardPoint } from './canvasProjection';

/** jsdom implements neither `viewBox.baseVal` nor a laid-out `getBoundingClientRect`, so a canvas
 *  is stood up by hand: a viewBox, and the on-screen box the pan/zoom transform has put it in. */
const canvas = (
  box: { x: number; y: number; width: number; height: number },
  rect: { left: number; top: number; width: number; height: number },
): SVGSVGElement =>
  ({
    viewBox: { baseVal: box },
    getBoundingClientRect: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }),
  }) as unknown as SVGSVGElement;

const VIEW = { x: 0, y: 0, width: 100, height: 100 };

describe('clientToBoardPoint', () => {
  it('maps a client point through the SVG’s on-screen box, not its untransformed layout box', () => {
    // The untransformed layout box is 400×400 at the origin; react-zoom-pan-pinch has zoomed it
    // 2× and panned it, so on screen it is 800×800 at (-100, -50). Ignoring that ancestor scale
    // — what WebKit's getScreenCTM() does (webkit.org/b/209220) — would answer (75, 100).
    const svg = canvas(VIEW, { left: -100, top: -50, width: 800, height: 800 });
    expect(clientToBoardPoint(svg, 300, 400)).toEqual({ x: 50, y: 56.25 });
  });

  it('centres the viewBox in the letterboxing a non-matching aspect ratio leaves (xMidYMid meet)', () => {
    // A square viewBox in a 600×300 box: it renders 300×300, with 150px of slack either side.
    const svg = canvas(VIEW, { left: 0, top: 0, width: 600, height: 300 });
    expect(clientToBoardPoint(svg, 150, 0)).toEqual({ x: 0, y: 0 });
    expect(clientToBoardPoint(svg, 450, 300)).toEqual({ x: 100, y: 100 });
  });

  it('carries the viewBox origin, so the world canvas answers in lon/lat', () => {
    const svg = canvas(
      { x: -540, y: -90, width: 1080, height: 180 },
      {
        left: 0,
        top: 0,
        width: 1080,
        height: 180,
      },
    );
    expect(clientToBoardPoint(svg, 540, 90)).toEqual({ x: 0, y: 0 });
  });

  it('returns null before the canvas is laid out', () => {
    expect(
      clientToBoardPoint(canvas(VIEW, { left: 0, top: 0, width: 0, height: 0 }), 5, 5),
    ).toBeNull();
    expect(clientToBoardPoint({} as SVGSVGElement, 5, 5)).toBeNull();
  });
});
