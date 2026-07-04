import { describe, it, expect } from 'vitest';
import { buildRouteGeometryFor, computeRouteOffsetsFor, BOW_LIMIT } from '../src/index';
import type { GeometryCity, GeometryRoute } from '../src/index';

// Horizontal chord a→b with one intruding town just south of it. Chord normal is (0, 1),
// so a positive bow moves the apex south (larger y), negative north.
const cities: GeometryCity[] = [
  { id: 'a', x: 20, y: 50 },
  { id: 'b', x: 80, y: 50 },
  { id: 'town', x: 50, y: 52 },
];

const route = (over: Partial<GeometryRoute> = {}): GeometryRoute => ({
  id: 'r1',
  a: 'a',
  b: 'b',
  length: 4,
  ...over,
});

describe('explicit route bow', () => {
  it('exports the authoring clamp', () => {
    expect(BOW_LIMIT).toBe(12);
  });

  it('without a bow the route still auto-bows away from the intruding town', () => {
    const { geometry } = buildRouteGeometryFor(cities, [route()]);
    // town sits south of the chord → the curve arcs north (apex y < 50).
    expect(geometry.get('r1')!.mid.y).toBeLessThan(49.5);
  });

  it('an explicit bow places the apex exactly bow units along the chord normal', () => {
    const { geometry } = buildRouteGeometryFor(cities, [route({ bow: -6 })]);
    expect(geometry.get('r1')!.mid.x).toBeCloseTo(50, 5);
    expect(geometry.get('r1')!.mid.y).toBeCloseTo(44, 5);
  });

  it('bow: 0 forces a straight route despite the intruder', () => {
    const { geometry } = buildRouteGeometryFor(cities, [route({ bow: 0 })]);
    expect(geometry.get('r1')!.mid.y).toBeCloseTo(50, 5);
  });

  it('an authored bow may exceed the MAX_BOW auto clamp', () => {
    const { geometry } = buildRouteGeometryFor(cities, [route({ bow: 10 })]);
    expect(geometry.get('r1')!.mid.y).toBeCloseTo(60, 5);
  });

  it('a double pair keeps its twin-track gap and both siblings take the explicit bow', () => {
    const pair = [
      route({ id: 'r1', doubleGroup: 'A', bow: 3 }),
      route({ id: 'r2', doubleGroup: 'A', bow: 3 }),
    ];
    const offsets = computeRouteOffsetsFor(cities, pair);
    expect(offsets.get('r1')!.bow).toBe(3);
    expect(offsets.get('r2')!.bow).toBe(3);
    expect(offsets.get('r1')!.gap).not.toBe(0);
    expect(offsets.get('r1')!.gap).toBe(-offsets.get('r2')!.gap);
  });
});
