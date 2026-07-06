import { TAIWAN_CONTENT, buildRouteGeometryFor } from '@trm/map-data';
import { boardToScreen, homeCamera, boundsOfContent } from './camera';
import { buildHitScene, hitTest } from './hitTest';

const { geometry } = buildRouteGeometryFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes);
const scene = buildHitScene(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes, geometry);
const vp = { w: 400, h: 800 };
const cam = homeCamera(boundsOfContent(TAIWAN_CONTENT), vp);

const cityPx = (id: string) => {
  const c = TAIWAN_CONTENT.cities.find((x) => (x.id as string) === id)!;
  return boardToScreen({ x: c.x, y: c.y }, cam, vp);
};

describe('hitTest', () => {
  it('a tap on a city marker returns that city (cities beat routes)', () => {
    expect(hitTest(cityPx('taipei'), cam, vp, scene)).toEqual({ kind: 'city', id: 'taipei' });
  });
  it('a tap on a route mid-slot returns that route', () => {
    const anyRoute = TAIWAN_CONTENT.routes[0]!;
    const g = geometry.get(anyRoute.id as string)!;
    const slot = g.slots[Math.floor(g.slots.length / 2)]!;
    const px = boardToScreen({ x: slot.x + g.perp.x, y: slot.y + g.perp.y }, cam, vp);
    expect(hitTest(px, cam, vp, scene)).toEqual({ kind: 'route', id: anyRoute.id });
  });
  it('every route is tappable at its middle slot at home zoom (no dead routes)', () => {
    for (const r of TAIWAN_CONTENT.routes) {
      const g = geometry.get(r.id as string)!;
      const slot = g.slots[Math.floor(g.slots.length / 2)]!;
      const px = boardToScreen({ x: slot.x + g.perp.x, y: slot.y + g.perp.y }, cam, vp);
      const hit = hitTest(px, cam, vp, scene);
      // A tap dead-centre on one of a double pair may land on the twin — both are answers
      // the UI can work with; what may NOT happen is null or a city.
      expect(hit?.kind).toBe('route');
    }
  });
  it('double-route siblings resolve to the nearer twin', () => {
    const pair = TAIWAN_CONTENT.routes.filter((r) => r.doubleGroup === 'A');
    expect(pair.length).toBe(2); // re-verify group id against routes.ts if this fails
    const [r1] = pair;
    const g1 = geometry.get(r1!.id as string)!;
    const slot = g1.slots[0]!;
    // Bias the tap toward r1's own perp side.
    const px = boardToScreen({ x: slot.x + g1.perp.x * 1.2, y: slot.y + g1.perp.y * 1.2 }, cam, vp);
    expect(hitTest(px, cam, vp, scene)).toEqual({ kind: 'route', id: r1!.id });
  });
  it('open sea is a miss', () => {
    expect(hitTest({ x: 4, y: 4 }, cam, vp, scene)).toBeNull();
  });
});
