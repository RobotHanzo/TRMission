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
// imports (custom-map geography rendering) keep working.
export { smoothClosedPath } from '@trm/map-data';
