// Manual hit-testing for the Skia board (Skia has no per-element onPress): invert the view
// transform, then run point-vs-polyline distance tests against each route's slot chain and
// point-vs-radius tests against city markers. Pure functions — the whole file unit-tests
// without a device. Tolerances are finger-sized in SCREEN px, converted to board units
// through the live camera, with board-unit floors so extreme zoom-out stays tappable.
import type { RouteGeometry } from '@trm/map-data';
import { screenToBoard, pxPerUnit, type CameraState, type Viewport } from './camera';

/** Finger slop in screen px (Material touch-target ≈ 44–48px; slop is the half-width). */
const TAP_SLOP_PX = 22;
/** Board-unit floors, so hit areas never collapse below the drawn footprint. */
const ROUTE_MIN_TOL = 1.1; // ≈ roadbed half-width + margin
const CITY_MIN_TOL = 1.7; // ≈ marker radius + margin
/** A station wins a tie against a route within this board-unit margin — routes end ON their
 *  endpoint cities, so at a junction the station and route are both ≈0 away; this hysteresis
 *  (< the distance from any mid-slot to its city) makes the tap resolve to the station there. */
const CITY_TIE_BIAS = 1.0;

export interface HitScene {
  cities: readonly { id: string; x: number; y: number }[];
  /** Per route: the polyline through [cityA, ...slot centres..., cityB], pre-offset by perp. */
  routes: readonly { id: string; pts: readonly { x: number; y: number }[] }[];
}

/** Precompute the per-route polylines once per catalog (geometry is immutable per content). */
export function buildHitScene(
  cities: readonly { id: string; x: number; y: number }[],
  routes: readonly { id: string; a: string; b: string }[],
  geometry: ReadonlyMap<string, RouteGeometry>,
): HitScene {
  const cityById = new Map(cities.map((c) => [c.id as string, c]));
  const outRoutes = routes.flatMap((r) => {
    const g = geometry.get(r.id as string);
    const a = cityById.get(r.a as string);
    const b = cityById.get(r.b as string);
    if (!g || !a || !b) return [];
    // The renderer nudges double siblings by perp (counter-scaled); at tap zooms the
    // nudge ≈ its board value, so baking raw perp in keeps the twins separable.
    const off = g.perp;
    const pts = [
      { x: a.x + off.x, y: a.y + off.y },
      ...g.slots.map((s) => ({ x: s.x + off.x, y: s.y + off.y })),
      { x: b.x + off.x, y: b.y + off.y },
    ];
    return [{ id: r.id as string, pts }];
  });
  return { cities: cities.map((c) => ({ id: c.id as string, x: c.x, y: c.y })), routes: outRoutes };
}

const distToSegment = (
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
};

export type Hit = { kind: 'city'; id: string } | { kind: 'route'; id: string } | null;

export function hitTest(
  ptPx: { x: number; y: number },
  cam: CameraState,
  vp: Viewport,
  scene: HitScene,
): Hit {
  const p = screenToBoard(ptPx, cam, vp);
  const s = pxPerUnit(cam, vp);
  const cityTol = Math.max(CITY_MIN_TOL, TAP_SLOP_PX / s);
  const routeTol = Math.max(ROUTE_MIN_TOL, TAP_SLOP_PX / s);

  let bestCity: { id: string; d: number } | null = null;
  for (const c of scene.cities) {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d <= cityTol && (!bestCity || d < bestCity.d)) bestCity = { id: c.id, d };
  }

  let bestRoute: { id: string; d: number } | null = null;
  for (const r of scene.routes) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const d = distToSegment(p, r.pts[i]!, r.pts[i + 1]!);
      if (d <= routeTol && (!bestRoute || d < bestRoute.d)) bestRoute = { id: r.id, d };
    }
  }

  // Closest target wins, with cities breaking ties: a station (the smaller target) beats a route
  // only when it is at least as near, which is exactly the junction case. Plain city-first would let
  // a station 2–3 board units away swallow a tap sitting on a route slot at wide (home) zoom, where
  // the finger slop is large in board units — so short routes near stations become untappable.
  if (bestCity && (!bestRoute || bestCity.d <= bestRoute.d + CITY_TIE_BIAS)) {
    return { kind: 'city', id: bestCity.id };
  }
  return bestRoute ? { kind: 'route', id: bestRoute.id } : null;
}
