import { TAIWAN_CONTENT, buildRouteGeometryFor } from '@trm/map-data';
import {
  boardToScreen,
  boundsOfContent,
  homeCamera,
  invScale,
  webScaleEquiv,
  SPAN_MIN,
  type CameraState,
} from './camera';
import { buildHitScene, hitTest } from './hitTest';

const { geometry } = buildRouteGeometryFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes);
const scene = buildHitScene(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes, geometry);
const vp = { w: 400, h: 800 };
const cam = homeCamera(boundsOfContent(TAIWAN_CONTENT), vp);

const hit = (px: { x: number; y: number }, at: CameraState = cam) =>
  hitTest(px, at, vp, scene, cam.span);

/** The renderer's counter-scale at a camera — what `perp` is multiplied by when drawn. */
const invAt = (at: CameraState) => invScale(webScaleEquiv(at.span, cam.span));

const cityAt = (id: string) => {
  const c = TAIWAN_CONTENT.cities.find((x) => (x.id as string) === id)!;
  return { x: c.x, y: c.y };
};
const cityPx = (id: string) => boardToScreen(cityAt(id), cam, vp);

/** Where a route's middle car is actually DRAWN at `at` (base curve + counter-scaled nudge). */
const drawnMidSlot = (routeId: string, at: CameraState) => {
  const g = geometry.get(routeId)!;
  const slot = g.slots[Math.floor(g.slots.length / 2)]!;
  const i = invAt(at);
  return { x: slot.x + g.perp.x * i, y: slot.y + g.perp.y * i };
};

/** Walk `dist` board units along a polyline from its first point. */
const alongPolyline = (pts: readonly { x: number; y: number }[], dist: number) => {
  let left = dist;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= left) {
      const t = left / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= len;
  }
  return pts[pts.length - 1]!;
};

/** A camera zoomed all the way in, centred on a board point. */
const closeUpOn = (p: { x: number; y: number }): CameraState => ({
  cx: p.x,
  cy: p.y,
  span: SPAN_MIN,
});

const doublePairs = (): [string, string][] => {
  const byGroup = new Map<string, string[]>();
  for (const r of TAIWAN_CONTENT.routes) {
    if (!r.doubleGroup) continue;
    const ids = byGroup.get(r.doubleGroup) ?? [];
    ids.push(r.id as string);
    byGroup.set(r.doubleGroup, ids);
  }
  return [...byGroup.values()].filter((ids): ids is [string, string] => ids.length === 2);
};

describe('hitTest', () => {
  it('a tap on a city marker returns that city (cities beat routes)', () => {
    expect(hit(cityPx('taipei'))).toEqual({ kind: 'city', id: 'taipei' });
  });
  it('a tap on a route mid-slot returns that route', () => {
    const anyRoute = TAIWAN_CONTENT.routes[0]!;
    const px = boardToScreen(drawnMidSlot(anyRoute.id as string, cam), cam, vp);
    expect(hit(px)).toEqual({ kind: 'route', id: anyRoute.id });
  });
  it('every route is tappable at its middle slot at home zoom (no dead routes)', () => {
    for (const r of TAIWAN_CONTENT.routes) {
      const px = boardToScreen(drawnMidSlot(r.id as string, cam), cam, vp);
      // A tap dead-centre on one of a double pair may land on the twin — both are answers
      // the UI can work with; what may NOT happen is null or a city.
      expect(hit(px)?.kind).toBe('route');
    }
  });
  it('double-route siblings resolve to the nearer twin', () => {
    const pair = TAIWAN_CONTENT.routes.filter((r) => r.doubleGroup === 'A');
    expect(pair.length).toBe(2); // re-verify group id against routes.ts if this fails
    const [r1] = pair;
    const g1 = geometry.get(r1!.id as string)!;
    const slot = g1.slots[Math.floor(g1.slots.length / 2)]!;
    // Bias the tap past r1's own (drawn) side of the pair.
    const off = invAt(cam) * 1.2;
    const px = boardToScreen({ x: slot.x + g1.perp.x * off, y: slot.y + g1.perp.y * off }, cam, vp);
    expect(hit(px)).toEqual({ kind: 'route', id: r1!.id });
  });
  it('open sea is a miss', () => {
    expect(hit({ x: 4, y: 4 })).toBeNull();
  });

  // ── Zoom-respecting hit areas (issue #68) ────────────────────────────────────
  describe('zoomed in', () => {
    it('each twin of every double pair is tappable where it is drawn', () => {
      for (const [idA, idB] of doublePairs()) {
        for (const id of [idA, idB]) {
          const at = closeUpOn(drawnMidSlot(id, { cx: 0, cy: 0, span: SPAN_MIN }));
          const px = boardToScreen(drawnMidSlot(id, at), at, vp);
          expect(hit(px, at)).toEqual({ kind: 'route', id });
        }
      }
    });

    it('a tap on a track a station-marker away from its endpoint is the route, not the station', () => {
      // The reported case: two parallel routes leaving a station. Zoomed in, the twins are ~16px
      // apart on screen and the marker is ~24px across, so a tap 1 board unit (≈50px) down the
      // track is unambiguous to the eye — it used to build a station instead.
      for (const [idA, idB] of doublePairs()) {
        for (const id of [idA, idB]) {
          const g = geometry.get(id)!;
          const r = TAIWAN_CONTENT.routes.find((x) => (x.id as string) === id)!;
          const a = cityAt(r.a as string);
          const base = [a, ...g.slots.map((s) => ({ x: s.x, y: s.y }))];
          const p = alongPolyline(base, 1);
          const at = closeUpOn(p);
          const i = invAt(at);
          const px = boardToScreen({ x: p.x + g.perp.x * i, y: p.y + g.perp.y * i }, at, vp);
          expect(hit(px, at)).toEqual({ kind: 'route', id });
        }
      }
    });

    it('a tap on the station itself still builds there', () => {
      const p = cityAt('taichung');
      const at = closeUpOn(p);
      expect(hit(boardToScreen(p, at, vp), at)).toEqual({ kind: 'city', id: 'taichung' });
    });

    it("a station's hit area shrinks with its drawn marker", () => {
      // Isolated so the assertion is about the tolerance alone: 1.2 board units out is well
      // inside a finger at home zoom, and well outside the drawn marker at SPAN_MIN.
      const solo = { cities: [{ id: 'solo', x: 50, y: 50 }], routes: [] };
      const probe = { x: 51.2, y: 50 };
      expect(hitTest(boardToScreen(probe, cam, vp), cam, vp, solo, cam.span)).toEqual({
        kind: 'city',
        id: 'solo',
      });
      const at = closeUpOn(probe);
      expect(hitTest(boardToScreen(probe, at, vp), at, vp, solo, cam.span)).toBeNull();
    });
  });
});
