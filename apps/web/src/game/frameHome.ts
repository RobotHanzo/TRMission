import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { fitTransform } from './geography';

/**
 * The home/reset view: frame the geography's whole `path.land` silhouette to the live viewport and
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
  if (!wrap || !content || typeof DOMMatrix === 'undefined') return; // needs a real DOM
  const wr = wrap.getBoundingClientRect();
  // EVERY land ring, not the first: the bundled map draws its silhouette as one `path.land`, but a
  // custom map's cartography is one path per ring (Geography.tsx's CustomGeography). Framing to
  // whichever ring the clipper happened to emit first would fit a stray islet and zoom the home
  // view straight into the maxScale ceiling.
  const lr = unionRect(content.querySelectorAll<SVGPathElement>('path.land'));
  if (!lr || !wr.width || !wr.height || !lr.width || !lr.height) return; // not laid out (e.g. jsdom)
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

/** Bounding rect covering every element, in client space; null if none of them has been laid out.
 *  Zero-area entries are skipped so an empty ring can't drag the union to the origin. */
function unionRect(
  els: ArrayLike<Element>,
): { left: number; top: number; width: number; height: number } | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < els.length; i++) {
    const r = els[i]!.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (left === Infinity) return null;
  return { left, top, width: right - left, height: bottom - top };
}
