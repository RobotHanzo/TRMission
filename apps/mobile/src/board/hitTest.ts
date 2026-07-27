// Manual hit-testing for the Skia board (Skia has no per-element onPress): invert the view
// transform, then run point-vs-polyline distance tests against each route's slot chain and
// point-vs-radius tests against city markers. Pure functions — the whole file unit-tests
// without a device.
//
// Everything is measured against what is actually DRAWN at the tap's zoom. The scene stores
// un-nudged polylines; the double-pair `perp` separation and every board-unit tolerance are
// re-derived per tap from the camera through the same counter-scales the renderer uses
// (`invScale` for track weight, `markerScale` for station markers) — the mobile equivalent of the
// web board stroking its invisible `.hit` target at `--m-hit-w * --inv-scale` (game.css). Baking
// them at one zoom is what made zooming in NOT improve aim (issue #68): at SPAN_MIN the drawn
// twin tracks sit ±0.16 board units off the chord while a baked raw `perp` left their hit lines
// at ±1.35, so a tap on either visible track matched neither and fell through to the station.
import { MAP_DIMS, type RouteGeometry } from '@trm/map-data';
import {
  invScale,
  markerScale,
  pxPerUnit,
  screenToBoard,
  webScaleEquiv,
  type CameraState,
  type Viewport,
} from './camera';

const D = MAP_DIMS;

/** Finger slop in screen px (Material touch-target ≈ 44–48px; slop is the half-width). */
const TAP_SLOP_PX = 22;
/** Widest drawn marker half-extent (island dot / hub slot) in board units, before `markerScale`.
 *  One radius for every stop: it only ever acts as a floor under the finger slop, and on the
 *  tie-break below, where a fifth of a board unit either way is invisible to a finger. */
const MARKER_R = Math.max(D.cityR, D.islandR, D.hubW / 2);

export interface HitScene {
  cities: readonly { id: string; x: number; y: number }[];
  /** Per route: the polyline through [cityA, ...slot centres..., cityB] on the route's own curve,
   *  plus the double-pair `perp` nudge — applied at the tap's zoom, exactly as the renderer
   *  applies it (`RouteLayer`'s counter-scaled Group transform), never baked in here. */
  routes: readonly {
    id: string;
    pts: readonly { x: number; y: number }[];
    perp: { x: number; y: number };
  }[];
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
    const pts = [
      { x: a.x, y: a.y },
      ...g.slots.map((s) => ({ x: s.x, y: s.y })),
      { x: b.x, y: b.y },
    ];
    return [{ id: r.id as string, pts, perp: { x: g.perp.x, y: g.perp.y } }];
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
  /** The home framing's span — the anchor `webScaleEquiv` maps a span onto the web's zoom scale,
   *  so the tolerances below track the renderer's LOD (`useBoardCamera`) rather than a fixed zoom. */
  homeSpan: number,
): Hit {
  const p = screenToBoard(ptPx, cam, vp);
  const s = pxPerUnit(cam, vp);
  // Finger slop dominates on a phone at every zoom; the drawn footprints below take over on a
  // wide viewport zoomed all the way in, where a station's marker is bigger than the slop.
  const slop = TAP_SLOP_PX / s;
  const scale = webScaleEquiv(cam.span, homeSpan);
  const inv = invScale(scale);
  const marker = markerScale(scale);
  const markerR = MARKER_R * marker;
  const cityTol = Math.max(markerR, slop);
  const routeTol = Math.max((D.hitW / 2) * inv, slop);

  let bestCity: { id: string; d: number } | null = null;
  for (const c of scene.cities) {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d <= cityTol && (!bestCity || d < bestCity.d)) bestCity = { id: c.id, d };
  }

  let bestRoute: { id: string; d: number } | null = null;
  for (const r of scene.routes) {
    // Measuring in the route's own nudged frame == offsetting every point by perp·inv.
    const q = { x: p.x - r.perp.x * inv, y: p.y - r.perp.y * inv };
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const d = distToSegment(q, r.pts[i]!, r.pts[i + 1]!);
      if (d <= routeTol && (!bestRoute || d < bestRoute.d)) bestRoute = { id: r.id, d };
    }
  }

  // Closest target wins, with a station breaking ties inside its own drawn marker — routes end ON
  // their endpoint cities, so at a junction the station and route are both ≈0 away and the tap
  // should resolve to the station. Plain city-first would instead let a station swallow a tap
  // sitting on a route slot at wide (home) zoom, where the finger slop is large in board units —
  // so short routes near stations would become untappable.
  if (bestCity && (!bestRoute || bestCity.d <= bestRoute.d + markerR)) {
    return { kind: 'city', id: bestCity.id };
  }
  return bestRoute ? { kind: 'route', id: bestRoute.id } : null;
}
