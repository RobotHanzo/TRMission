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
 * uses the classic Catmull–Rom tangent `(pₙ₊₁ − pₙ₋₁)/6`, which overshoots badly on the sparse,
 * unevenly-spaced Natural-Earth vertices a custom map is built from: the curve balloons outside the
 * true outline, so coastlines render as inflated "melted" blobs — and the smaller each landmass is
 * (i.e. the larger the selection), the more that inflation is all you see. This variant hugs the
 * outline instead, by (a) a gentler tangent (`/TENSION`) and (b) clamping each control handle to a
 * fraction of the segment it serves (`CLAMP`), which kills the overshoot on the long-segment /
 * short-segment junctions where the stock curve bulges worst. The result is smooth but faithful,
 * and — being purely scale-relative — identical in quality at every selection size.
 *
 * Taiwan's own hand-authored silhouette is dense and evenly sampled, so it never overshot; it keeps
 * using `smoothClosedPath` and is deliberately left untouched.
 */
export function smoothCoastPath(pts: readonly (readonly [number, number])[]): string {
  const TENSION = 12; // classic Catmull–Rom is 6; the gentler pull keeps the curve near the outline
  const CLAMP = 0.5; // cap each handle at half its segment so it can't bulge past the next vertex
  const n = pts.length;
  if (n < 3) return '';
  const at = (i: number): readonly [number, number] => pts[((i % n) + n) % n]!;
  const f = (v: number): string => v.toFixed(2);
  const clampLen = (x: number, y: number, max: number): [number, number] => {
    const len = Math.hypot(x, y);
    return len > max && len > 0 ? [(x * max) / len, (y * max) / len] : [x, y];
  };
  const start = at(0);
  let d = `M ${f(start[0])} ${f(start[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const [c1x, c1y] = clampLen((p2[0] - p0[0]) / TENSION, (p2[1] - p0[1]) / TENSION, seg * CLAMP);
    const [c2x, c2y] = clampLen((p3[0] - p1[0]) / TENSION, (p3[1] - p1[1]) / TENSION, seg * CLAMP);
    d += ` C ${f(p1[0] + c1x)} ${f(p1[1] + c1y)}, ${f(p2[0] - c2x)} ${f(p2[1] - c2y)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}
