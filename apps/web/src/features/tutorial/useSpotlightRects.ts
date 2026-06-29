import { useEffect, useState } from 'react';
import type { Spotlight } from './types';
import { selectorsForSpotlight, type FlatRect } from './focus';

/** How long after a beat change to keep re-measuring, so holes track the board's pan/zoom. */
const TRACK_MS = 700;

/** Live screen rects of the current beat's spotlight targets. Empty when nothing resolves. */
export function useSpotlightRects(spotlight: Spotlight | undefined): FlatRect[] {
  const [rects, setRects] = useState<FlatRect[]>([]);
  // A stable key so the effect refires on the beat's spotlight, not on every parent render.
  const key = spotlight ? JSON.stringify(spotlight) : '';

  useEffect(() => {
    const selectors = selectorsForSpotlight(spotlight);
    if (selectors.length === 0) {
      setRects([]);
      return;
    }
    let raf = 0;
    const start = typeof performance !== 'undefined' ? performance.now() : 0;

    const measure = (): void => {
      const next: FlatRect[] = [];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) next.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      setRects(next);
    };

    const tick = (): void => {
      measure();
      const now = typeof performance !== 'undefined' ? performance.now() : start + TRACK_MS;
      if (now - start < TRACK_MS && typeof requestAnimationFrame !== 'undefined') {
        raf = requestAnimationFrame(tick);
      }
    };
    tick();
    window.addEventListener('resize', measure);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [key]);

  return rects;
}
