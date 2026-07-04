import { describe, it, expect } from 'vitest';
import { bowFromPoint } from './curveMath';
import { buildRouteGeometryFor } from '../../../game/routeGeometry';

describe('bowFromPoint', () => {
  it('projects onto the chord normal for a horizontal chord (normal points +y)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(bowFromPoint(a, b, { x: 5, y: 3 })).toBeCloseTo(3, 5);
    expect(bowFromPoint(a, b, { x: 5, y: -4 })).toBeCloseTo(-4, 5);
    // Movement along the chord contributes nothing.
    expect(bowFromPoint(a, b, { x: 9, y: 3 })).toBeCloseTo(3, 5);
  });

  it('matches the geometry module sign convention (round-trip through the apex)', () => {
    const cities = [
      { id: 'a', x: 20, y: 30 },
      { id: 'b', x: 70, y: 80 },
    ];
    const routes = [{ id: 'r1', a: 'a', b: 'b', length: 3, bow: -5 }];
    const { geometry } = buildRouteGeometryFor(cities, routes);
    const apex = geometry.get('r1')!.mid;
    expect(bowFromPoint(cities[0]!, cities[1]!, apex)).toBeCloseTo(-5, 5);
  });
});
