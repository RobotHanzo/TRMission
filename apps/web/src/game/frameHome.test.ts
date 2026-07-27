import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { frameHome } from './frameHome';

const SVG_NS = 'http://www.w3.org/2000/svg';

// jsdom ships no DOMMatrix, and frameHome bails without one. The identity it would read off an
// untransformed content div is all these cases need.
beforeAll(() => {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class {
      a = 1;
      e = 0;
      f = 0;
    };
  }
});

/** jsdom does no layout, so every rect the framing math reads is stubbed here. */
const withRect = <T extends Element>(el: T, r: Partial<DOMRect>): T => {
  const rect = { left: 0, top: 0, width: 0, height: 0, ...r };
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }),
  });
  return el;
};

/** A pan/zoom ref whose content holds one `path.land` per `rings` entry. */
const refWith = (rings: Partial<DOMRect>[]) => {
  const wrapper = withRect(document.createElement('div'), { width: 800, height: 800 });
  const content = document.createElement('div');
  for (const r of rings) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'land');
    content.appendChild(withRect(path, r));
  }
  wrapper.appendChild(content);
  document.body.appendChild(wrapper);
  const setTransform = vi.fn();
  return {
    setTransform,
    ref: {
      instance: { wrapperComponent: wrapper, contentComponent: content },
      setTransform,
    } as unknown as ReactZoomPanPinchContentRef,
  };
};

describe('frameHome', () => {
  it('fits the union of every land ring, not whichever one is drawn first', () => {
    // A custom map draws one path per ring and the clipper can emit a stray islet first. Fitting
    // that islet alone asks for 0.9 * 800 / 20 = 36x, i.e. the 8x ceiling — the whole map off screen.
    const { ref, setTransform } = refWith([
      { left: 10, top: 10, width: 20, height: 20 }, // islet
      { left: 100, top: 100, width: 400, height: 600 }, // the actual landmass
    ]);

    frameHome(ref, 0);

    const scale = setTransform.mock.calls[0]![2] as number;
    // Union spans 10..500 x 10..700 ⇒ height-bound at 0.9 * 800 / 690.
    expect(scale).toBeCloseTo(1.0434782, 5);
  });

  it('ignores rings that have not been laid out', () => {
    const { ref, setTransform } = refWith([
      { left: 0, top: 0, width: 0, height: 0 }, // never laid out — must not drag the union
      { left: 100, top: 100, width: 400, height: 600 },
    ]);

    frameHome(ref, 0);

    expect(setTransform.mock.calls[0]![2]).toBeCloseTo(1.2, 5);
  });

  it('does nothing when no land has been laid out at all', () => {
    const { ref, setTransform } = refWith([{ left: 0, top: 0, width: 0, height: 0 }]);

    frameHome(ref, 0);

    expect(setTransform).not.toHaveBeenCalled();
  });
});
