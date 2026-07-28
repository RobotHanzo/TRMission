import { describe, it, expect, vi } from 'vitest';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { HOME_FIT } from '@trm/client-core/game/boardModel';
import { frameHome } from './frameHome';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** jsdom does no layout and has no SVG geometry, so both sides of the framing math are stubbed:
 *  the wrapper's rect and the board svg's viewBox→content-pixel matrix (`k·board + (e,f)`). */
const refWith = (
  ctm: { a: number; e: number; f: number } | null,
  wrapper: { width: number; height: number } = { width: 800, height: 800 },
) => {
  const wrap = document.createElement('div');
  Object.defineProperty(wrap, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, ...wrapper, right: wrapper.width, bottom: wrapper.height }),
  });
  const content = document.createElement('div');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'board');
  Object.defineProperty(svg, 'getCTM', { value: () => ctm });
  content.appendChild(svg);
  wrap.appendChild(content);
  document.body.appendChild(wrap);
  const setTransform = vi.fn();
  return {
    setTransform,
    ref: {
      instance: { wrapperComponent: wrap, contentComponent: content },
      setTransform,
    } as unknown as ReactZoomPanPinchContentRef,
  };
};

describe('frameHome', () => {
  // 10 content px per board unit ⇒ a 40×60 box is 400×600 px; in an 800×800 viewport the height
  // is the constraining axis, so the fit is HOME_FIT * 800 / 600.
  const EXPECTED_SCALE = (HOME_FIT * 800) / 600;

  it('fits the given board-unit box to the viewport and centres it', () => {
    const { ref, setTransform } = refWith({ a: 10, e: 0, f: 0 });

    frameHome(ref, 0, { x: 20, y: 10, w: 40, h: 60 });

    const [x, y, scale] = setTransform.mock.calls[0] as [number, number, number];
    expect(scale).toBeCloseTo(EXPECTED_SCALE, 5);
    // Box centre (40, 40) board ⇒ (400, 400) content px ⇒ pulled to the viewport centre.
    expect(x).toBeCloseTo(400 - EXPECTED_SCALE * 400, 5);
    expect(y).toBeCloseTo(400 - EXPECTED_SCALE * 400, 5);
  });

  it('honours the svg viewBox offset, so a negative-origin base view still centres', () => {
    const { ref, setTransform } = refWith({ a: 10, e: 40, f: 20 });

    frameHome(ref, 0, { x: -4, y: -2, w: 40, h: 60 });

    const [x, y, scale] = setTransform.mock.calls[0] as [number, number, number];
    expect(scale).toBeCloseTo(EXPECTED_SCALE, 5);
    expect(x).toBeCloseTo(400 - EXPECTED_SCALE * (10 * 16 + 40), 5); // centre x = -4 + 20 = 16
    expect(y).toBeCloseTo(400 - EXPECTED_SCALE * (10 * 28 + 20), 5); // centre y = -2 + 30 = 28
  });

  it('does nothing before the board is laid out (no CTM — e.g. jsdom)', () => {
    const { ref, setTransform } = refWith(null);

    frameHome(ref, 0, { x: 0, y: 0, w: 40, h: 60 });

    expect(setTransform).not.toHaveBeenCalled();
  });

  it('does nothing for an empty box', () => {
    const { ref, setTransform } = refWith({ a: 10, e: 0, f: 0 });

    frameHome(ref, 0, { x: 0, y: 0, w: 0, h: 0 });

    expect(setTransform).not.toHaveBeenCalled();
  });
});
