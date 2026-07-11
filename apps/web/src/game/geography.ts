// The hand-authored Taiwan coastline/relief/islands themselves live in @trm/map-data
// (shared verbatim with the server's official-map social card, so neither can drift from
// the other); this module re-exports them under their existing web names and adds the
// viewport/pan-zoom concerns (BASE_VIEW, fitTransform, MIN/MAX_SCALE) that are web-only.
import {
  TAIWAN_BASE_VIEW,
  TAIWAN_OUTLINE as MD_TAIWAN_OUTLINE,
  TAIWAN_ISLANDS,
  TAIWAN_GRATICULE,
  TAIWAN_LAND_PATH as MD_TAIWAN_LAND_PATH,
  TAIWAN_CENTRAL_RANGE_PATH,
} from '@trm/map-data';

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Home view: frames the main island plus every outlying island (Kinmen west → Orchid SE). */
export const BASE_VIEW: View = TAIWAN_BASE_VIEW;

/** Pan/zoom bounds — kept in sync with the TransformWrapper props in Board.tsx. */
export const MIN_SCALE = 0.8;
export const MAX_SCALE = 8;

/** A rectangle in the pan/zoom content's own pixel space (the island silhouette, measured live). */
export interface FitTarget {
  cx: number;
  cy: number;
  w: number;
  h: number;
}
/** A react-zoom-pan-pinch transform: `translate(x, y) scale(scale)`, origin top-left. */
export interface FitTransform {
  scale: number;
  x: number;
  y: number;
}

/**
 * Frame a target rect to the viewport: the largest scale that *contains* the target (with a
 * `padding` margin), then the offset that centres it. This is the home/reset view — Taiwan is
 * tall-and-narrow inside a mostly-sea board, so a fixed scale (or a fit of the whole sea-padded
 * BASE_VIEW) leaves the island tiny; fitting the island itself keeps it large and centred on any
 * window shape. Pure so it can be unit-tested; Board.tsx measures the live `target`/`viewport`.
 */
export function fitTransform(
  target: FitTarget,
  viewport: { w: number; h: number },
  padding = 0.9,
): FitTransform {
  const raw = Math.min((padding * viewport.w) / target.w, (padding * viewport.h) / target.h);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
  return { scale, x: viewport.w / 2 - scale * target.cx, y: viewport.h / 2 - scale * target.cy };
}

export const TAIWAN_OUTLINE = MD_TAIWAN_OUTLINE;
export const ISLANDS = TAIWAN_ISLANDS;
export const GRATICULE = TAIWAN_GRATICULE;
export const TAIWAN_LAND_PATH = MD_TAIWAN_LAND_PATH;
export const CENTRAL_RANGE_PATH = TAIWAN_CENTRAL_RANGE_PATH;

// Catmull–Rom coastline smoothing lives in @trm/map-data too; re-exported so existing web
// imports keep working. The hand-authored Taiwan silhouette and the server OG card render through
// it — it stays exactly as-is.
export { smoothClosedPath } from '@trm/map-data';

/**
 * Coastline smoothing for **custom maps** (cropped-world land rings). The stock `smoothClosedPath`
 * uses the classic Catmull–Rom tangent `(pₙ₊₁ − pₙ₋₁)/6` with *uniform* parameterization, which
 * overshoots badly on the sparse, unevenly-spaced Natural-Earth vertices a custom map is built
 * from: the curve balloons outside the true outline, so coastlines render as inflated "melted"
 * blobs. A crop makes this worse in a second way — Sutherland–Hodgman clipping against the crop
 * rectangle's straight edges routinely stitches a long, dead-straight box-edge chord right next to
 * a short coastline segment (e.g. an island chain shaved by the crop boundary). Uniform
 * parameterization derives that short segment's tangent from the far neighbour *across* the long
 * chord, so even a magnitude clamp on the handle can't stop the curve from swinging past its own
 * outline: it self-intersects into little loops/spikes, and can bulge land outside the crop box's
 * straight edge entirely — an edge that must stay exactly as straight as the crop preview shows it.
 *
 * This uses **centripetal Catmull–Rom** (Barry–Goldman, knot spacing ∝ chord-length^0.5) instead of
 * an ad hoc tangent + clamp: it scales each tangent by the *local* knot spacing, so it stays well-
 * behaved regardless of how uneven neighbouring segments are, and is proven cusp/self-intersection-
 * free for any 4 non-coincident points — the standard fix for exactly this failure mode. Being
 * purely chord-length-relative, it's still identical in quality at every selection size.
 *
 * Taiwan's own hand-authored silhouette is dense and evenly sampled, so it never overshot; it keeps
 * using `smoothClosedPath` and is deliberately left untouched.
 */
export function smoothCoastPath(pts: readonly (readonly [number, number])[]): string {
  const n = pts.length;
  if (n < 3) return '';
  const at = (i: number): readonly [number, number] => pts[((i % n) + n) % n]!;
  const f = (v: number): string => v.toFixed(2);
  // Floored so three+ coincident/near-coincident points (duplicate vertices after rounding) can
  // never produce a zero knot span and divide-by-zero — they just contribute a negligible tangent.
  const knot = (a: readonly [number, number], b: readonly [number, number]): number =>
    Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1e-6) ** 0.5;
  const start = at(0);
  let d = `M ${f(start[0])} ${f(start[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    // A segment whose endpoints share an exact x or y is a crop-rectangle boundary chord — Sutherland–
    // Hodgman clipping only ever introduces points at a constant lon or lat, which projects to a
    // constant board x or y. That edge is the box the user actually drew: it must stay exactly as
    // straight as the crop preview shows it, never curved, no matter how short the neighbouring
    // coastline segments are (the one real case no tangent/clamp tuning can fully rule out).
    if (p1[0] === p2[0] || p1[1] === p2[1]) {
      d += ` L ${f(p2[0])} ${f(p2[1])}`;
      continue;
    }
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const m1x =
      ((t2 - t1) * (p1[0] - p0[0])) / (t1 - t0) -
      ((t2 - t1) * (p2[0] - p0[0])) / (t2 - t0) +
      ((t2 - t1) * (p2[0] - p1[0])) / (t2 - t1);
    const m1y =
      ((t2 - t1) * (p1[1] - p0[1])) / (t1 - t0) -
      ((t2 - t1) * (p2[1] - p0[1])) / (t2 - t0) +
      ((t2 - t1) * (p2[1] - p1[1])) / (t2 - t1);
    const m2x =
      ((t2 - t1) * (p2[0] - p1[0])) / (t2 - t1) -
      ((t2 - t1) * (p3[0] - p1[0])) / (t3 - t1) +
      ((t2 - t1) * (p3[0] - p2[0])) / (t3 - t2);
    const m2y =
      ((t2 - t1) * (p2[1] - p1[1])) / (t2 - t1) -
      ((t2 - t1) * (p3[1] - p1[1])) / (t3 - t1) +
      ((t2 - t1) * (p3[1] - p2[1])) / (t3 - t2);
    // Centripetal parameterization keeps any single Bezier segment cusp-free, but a closed ring
    // with a genuinely thin neck (two coastlines pinched close together, e.g. a narrow peninsula
    // sliced right at the crop edge) can still bulge two *non-adjacent* segments into each other.
    // A last clamp on each handle's own magnitude — capped to a small fraction of the segment it
    // serves — is a cheap backstop against that: it can only ever shrink the handle toward the
    // straight chord, never change its (already well-behaved) direction.
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const clampLen = (x: number, y: number, max: number): [number, number] => {
      const len = Math.hypot(x, y);
      return len > max && len > 0 ? [(x * max) / len, (y * max) / len] : [x, y];
    };
    const [c1dx, c1dy] = clampLen(m1x / 3, m1y / 3, seg * 0.15);
    const [c2dx, c2dy] = clampLen(m2x / 3, m2y / 3, seg * 0.15);
    const c1x = p1[0] + c1dx;
    const c1y = p1[1] + c1dy;
    const c2x = p2[0] - c2dx;
    const c2y = p2[1] - c2dy;
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}
