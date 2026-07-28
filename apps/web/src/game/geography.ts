// The hand-authored Taiwan coastline/relief/islands themselves live in @trm/map-data
// (shared verbatim with the server's official-map social card, so neither can drift from
// the other); this module re-exports them under their existing web names and adds the
// viewport/pan-zoom concerns (BASE_VIEW, fitTransform, MIN/MAX_SCALE) that are web-only.
import { HOME_FIT } from '@trm/client-core/game/boardModel';
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
 * `padding` margin), then the offset that centres it. This is the home/reset view — the board is
 * mostly sea and off-network land, so a fixed scale (or a fit of the whole sea-padded BASE_VIEW)
 * leaves the railways tiny; fitting the network box (`homeBounds`) keeps them large and centred on
 * any window shape. Pure so it can be unit-tested; `frameHome` measures the live viewport.
 */
export function fitTransform(
  target: FitTarget,
  viewport: { w: number; h: number },
  padding = HOME_FIT,
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

// Coastline smoothing for CUSTOM-MAP land rings (cropped world) lives in @trm/map-data as well,
// so `apps/mobile`'s Skia board and mission cards draw the identical outline — re-exported here
// under the name the web components already import.
export { smoothCoastPath } from '@trm/map-data';
