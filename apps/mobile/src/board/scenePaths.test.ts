import { TAIWAN_CONTENT, buildRouteGeometryFor } from '@trm/map-data';
import { buildRouteRenderModel, ferryLocoBlock } from './scenePaths';

const { geometry } = buildRouteGeometryFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes);

describe('buildRouteRenderModel', () => {
  const model = buildRouteRenderModel(TAIWAN_CONTENT.routes, geometry);

  it('produces one entry per route with a parsed bed path', () => {
    expect(model.length).toBe(TAIWAN_CONTENT.routes.length);
    for (const m of model) expect(m.bed).toBeTruthy(); // SkPath (mock object in jest)
  });

  it('tunnel routes carry ties; ferries carry pips; plain routes carry slots only', () => {
    const tunnel = model.find((m) => m.isTunnel);
    expect(tunnel).toBeDefined();
    expect(tunnel!.ties.length).toBeGreaterThan(0);

    const ferry = model.find((m) => m.ferryLocos > 0);
    expect(ferry).toBeDefined();
    expect(ferry!.isFerry).toBe(true);

    const plain = model.find((m) => !m.isTunnel && !m.isFerry);
    expect(plain).toBeDefined();
    expect(plain!.ties.length).toBe(0);
    expect(plain!.slots.length).toBeGreaterThan(0);
  });
});

describe('ferryLocoBlock (ports RouteShape.tsx locoStart math)', () => {
  it('centres the loco block in the pip chain', () => {
    expect(ferryLocoBlock(4, 2)).toEqual({ start: 1, end: 3 }); // pips 1,2 of 0..3
    expect(ferryLocoBlock(3, 1)).toEqual({ start: 1, end: 2 });
    // With 0 locos the block is empty (start === end), so its start is moot — the web's
    // `max(0, floor((length - locos) / 2))` yields floor(3/2) = 1; we mirror that formula exactly.
    expect(ferryLocoBlock(3, 0)).toEqual({ start: 1, end: 1 });
  });
});
