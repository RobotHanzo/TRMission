import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { fitTransform } from './geography';

/**
 * The home/reset view: frame the geography's `path.land` silhouette to the live viewport and
 * centre it. The pan/zoom content sizes to the SVG's intrinsic box (not the viewport), so the
 * island's on-screen size can't be modelled from the viewport alone — we measure the rendered
 * land box and the current transform, recover the island's content-space rect, and fit that.
 * This holds at any window shape/geography, so every `MapScene` surface (the live board, the
 * builder canvas) that calls this on init settles at the same effective zoom — which keeps
 * `--inv-scale`, and so city-label size, in parity across surfaces.
 */
export function frameHome(ref: ReactZoomPanPinchContentRef, animationTime: number): void {
  const { instance, setTransform } = ref;
  const wrap = instance.wrapperComponent;
  const content = instance.contentComponent;
  const land = content?.querySelector<SVGPathElement>('path.land');
  if (!wrap || !content || !land || typeof DOMMatrix === 'undefined') return; // needs a real DOM
  const wr = wrap.getBoundingClientRect();
  const lr = land.getBoundingClientRect();
  if (!wr.width || !wr.height || !lr.width || !lr.height) return; // not laid out yet (e.g. jsdom)
  // Read the live transform straight off the DOM so it's consistent with the measured rect —
  // `instance.state` can still lag `centerOnInit` at onInit time, which would skew the centring.
  const css = getComputedStyle(content).transform;
  const m = css && css !== 'none' ? new DOMMatrix(css) : new DOMMatrix();
  const scale = m.a;
  if (!scale) return;
  // Un-apply that transform to recover the island's rect in the content's own pixel space.
  const target = {
    cx: (lr.left + lr.width / 2 - wr.left - m.e) / scale,
    cy: (lr.top + lr.height / 2 - wr.top - m.f) / scale,
    w: lr.width / scale,
    h: lr.height / scale,
  };
  const t = fitTransform(target, { w: wr.width, h: wr.height });
  setTransform(t.x, t.y, t.scale, animationTime, 'easeOut');
}
