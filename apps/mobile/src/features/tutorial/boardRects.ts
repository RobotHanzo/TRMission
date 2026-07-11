// Screen rects for city/route spotlight targets. The web measures SVG elements; the Skia board
// has no per-element nodes, so we compute: board-space bbox (the same endpoint-bbox the web's
// SpotlightFramer frames) → screen via the camera affine documented in game/boardView.ts
// (screen = viewportOrigin + position + (k·board + e|f)·scale). Pure — testable without a device.
import type { Spotlight } from './types';
import type { FlatRect } from './focus';
import type { BoardTransform, BoardProjection } from '../../game/boardView';

export interface BoardCameraSample {
  transform: BoardTransform;
  proj: BoardProjection;
}

type BoardSpotlight = Extract<Spotlight, { kind: 'cities' | 'route' }>;
type CityPoint = { x: number; y: number };
type RouteEnds = { a: string; b: string };

/** Board units of breathing room so the hole reads as a spotlight, not a bounding box. */
const CITY_PAD_BU = 3;
const ROUTE_PAD_BU = 2;

/** Board-space (0–100) bbox for a cities/route spotlight; null when nothing resolves. */
export function boardSpaceRect(
  spotlight: BoardSpotlight,
  cityById: ReadonlyMap<string, CityPoint>,
  routeById: ReadonlyMap<string, RouteEnds>,
): { x: number; y: number; w: number; h: number } | null {
  const cityIds =
    spotlight.kind === 'route'
      ? spotlight.ids.flatMap((rid) => {
          const r = routeById.get(rid);
          return r ? [r.a, r.b] : [];
        })
      : spotlight.ids;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cid of cityIds) {
    const c = cityById.get(cid);
    if (!c) continue;
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  if (!Number.isFinite(minX)) return null;
  const pad = spotlight.kind === 'route' ? ROUTE_PAD_BU : CITY_PAD_BU;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** Project a board-space rect into window space through the camera + the board viewport origin. */
export function projectBoardRect(
  rect: { x: number; y: number; w: number; h: number },
  cam: BoardCameraSample,
  viewport: FlatRect,
): FlatRect {
  const t: BoardTransform = cam.transform;
  const p: BoardProjection = cam.proj;
  const s = t.scale || 1;
  return {
    x: viewport.x + t.positionX + (p.k * rect.x + p.e) * s,
    y: viewport.y + t.positionY + (p.k * rect.y + p.f) * s,
    w: rect.w * p.k * s,
    h: rect.h * p.k * s,
  };
}

/** The spotlight-hole rects for a board-anchored beat: one hole per city (a ticket's two
 *  endpoints get two holes, matching the web), or a single union hole for a route set. */
export function boardAnchorRects(
  spotlight: BoardSpotlight,
  cityById: ReadonlyMap<string, CityPoint>,
  routeById: ReadonlyMap<string, RouteEnds>,
  cam: BoardCameraSample,
  viewport: FlatRect,
): FlatRect[] {
  if (spotlight.kind === 'cities') {
    return spotlight.ids.flatMap((id) => {
      const c = cityById.get(id);
      if (!c) return [];
      const bu = {
        x: c.x - CITY_PAD_BU,
        y: c.y - CITY_PAD_BU,
        w: CITY_PAD_BU * 2,
        h: CITY_PAD_BU * 2,
      };
      return [projectBoardRect(bu, cam, viewport)];
    });
  }
  const bb = boardSpaceRect(spotlight, cityById, routeById);
  return bb ? [projectBoardRect(bb, cam, viewport)] : [];
}
