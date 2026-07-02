import type { RefObject } from 'react';
import { useTransformEffect } from 'react-zoom-pan-pinch';

/** Sets `--inv-scale` and `--marker-scale` (both ≈ functions of 1/zoom, clamped) on the given
 *  element, mirroring the live board's ZoomTracker so builder canvases counter-scale label/
 *  stroke weight and grow station markers the same way the real board does instead of letting
 *  them balloon or vanish as the user zooms. Must render as a sibling of `TransformComponent`,
 *  inside `TransformWrapper`. */
export function ZoomVar({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  useTransformEffect(({ state }) => {
    const el = targetRef.current;
    if (!el) return;
    const s = state.scale;
    el.style.setProperty('--inv-scale', String(Math.max(0.08, Math.min(2, 1 / s))));
    el.style.setProperty('--marker-scale', String(Math.max(0.34, Math.min(0.82, 1 / Math.sqrt(s)))));
  });
  return null;
}
