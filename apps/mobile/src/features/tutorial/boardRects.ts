// Screen rects for city/route spotlight targets. The web measures SVG elements; the Skia board
// has no per-element nodes, so we compute: board-space bbox (the same endpoint-bbox the web's
// SpotlightFramer frames) → screen via the camera affine documented in game/boardView.ts
// (screen = viewportOrigin + position + (k·board + e|f)·scale). Pure — testable without a device.
import type { Spotlight } from './types';
import type { FlatRect } from './focus';
import type { BoardTransform, BoardProjection } from '../../game/boardView';
import type { RouteGeometry } from '../../game/routeGeometry';

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

/** Board-space (0–100) bbox for a cities/route spotlight; null when nothing resolves. A route's
 *  bbox is taken from its REAL rendered curve (car slots + apex), not just its two endpoint
 *  cities — the board draws every route as a quadratic-Bézier bow (an express bypass arcing
 *  around an intruding city, or an authored curve — routinely the case for ferries/tunnels, which
 *  often need to clear geography), so a chord-only bbox can miss the curve by several board units
 *  and the spotlight hole ends up nowhere near the drawn track. `routeGeometryById` is optional so
 *  a route the geometry map doesn't know about still falls back to the endpoint-only bbox. */
export function boardSpaceRect(
  spotlight: BoardSpotlight,
  cityById: ReadonlyMap<string, CityPoint>,
  routeById: ReadonlyMap<string, RouteEnds>,
  routeGeometryById?: ReadonlyMap<string, RouteGeometry>,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  if (spotlight.kind === 'cities') {
    for (const cid of spotlight.ids) {
      const c = cityById.get(cid);
      if (c) extend(c.x, c.y);
    }
  } else {
    for (const rid of spotlight.ids) {
      const r = routeById.get(rid);
      if (r) {
        const a = cityById.get(r.a);
        const b = cityById.get(r.b);
        if (a) extend(a.x, a.y);
        if (b) extend(b.x, b.y);
      }
      const geo = routeGeometryById?.get(rid);
      if (geo) {
        extend(geo.mid.x, geo.mid.y);
        for (const s of geo.slots) extend(s.x, s.y);
      }
    }
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
  routeGeometryById?: ReadonlyMap<string, RouteGeometry>,
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
  const bb = boardSpaceRect(spotlight, cityById, routeById, routeGeometryById);
  return bb ? [projectBoardRect(bb, cam, viewport)] : [];
}
