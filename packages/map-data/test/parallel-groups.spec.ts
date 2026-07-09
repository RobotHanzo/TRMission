import { describe, it, expect } from 'vitest';
import { validateContent } from '../src/validate';
import { buildRouteGeometryFor } from '../src/geometry';
import type { GameContent } from '../src/types';
import type { RouteColor } from '@trm/shared';

const city = (id: string, x = 0, y = 0) =>
  ({ id, nameZh: id, nameEn: id, x, y, region: 'r', isIsland: false }) as GameContent['cities'][number];
const route = (
  id: string,
  a: string,
  b: string,
  color: RouteColor,
  doubleGroup?: string,
  length = 1,
) =>
  ({
    id,
    a,
    b,
    color,
    length,
    ferryLocos: 0,
    isTunnel: false,
    ...(doubleGroup ? { doubleGroup } : {}),
  }) as GameContent['routes'][number];
const content = (routes: GameContent['routes'][number][]): GameContent => ({
  meta: { mapId: 'm', version: 1, nameZh: 'm', nameEn: 'm' },
  // two cities connected + a third so the graph is connected regardless of parallel edges
  cities: [city('a', 0, 0), city('b', 10, 0), city('c', 20, 0)],
  routes: [...routes, route('link', 'b', 'c', 'RED')],
  tickets: [],
});

describe('parallel-group validation', () => {
  it('accepts a 3-member (triple) group of equal length between one pair', () => {
    const res = validateContent(
      content([
        route('t1', 'a', 'b', 'RED', 'A'),
        route('t2', 'a', 'b', 'BLUE', 'A'),
        route('t3', 'a', 'b', 'GREEN', 'A'),
      ]),
    );
    expect(res.ok).toBe(true);
  });

  it('accepts a plain single route alongside a 2-member group on the same pair (v4 taipei-banqiao shape)', () => {
    const res = validateContent(
      content([
        route('u', 'a', 'b', 'ORANGE'),
        route('g1', 'a', 'b', 'GREEN', 'H'),
        route('g2', 'a', 'b', 'GRAY', 'H'),
      ]),
    );
    expect(res.ok).toBe(true); // 3 routes, one group H → allowed
  });

  it('rejects a 4-member group', () => {
    const res = validateContent(
      content([
        route('q1', 'a', 'b', 'RED', 'A'),
        route('q2', 'a', 'b', 'BLUE', 'A'),
        route('q3', 'a', 'b', 'GREEN', 'A'),
        route('q4', 'a', 'b', 'YELLOW', 'A'),
      ]),
    );
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain('doubleGroupInvalidSize');
    expect(res.issues.map((i) => i.code)).toContain('tooManyParallelRoutes');
  });

  it('rejects two distinct groups on the same city pair (the "4 rails" bug)', () => {
    const res = validateContent(
      content([
        route('a1', 'a', 'b', 'RED', 'A'),
        route('a2', 'a', 'b', 'BLUE', 'A'),
        route('b1', 'a', 'b', 'GREEN', 'B'),
        route('b2', 'a', 'b', 'YELLOW', 'B'),
      ]),
    );
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain('multipleGroupsOnPair');
  });

  it('rejects a 1-member group', () => {
    const res = validateContent(content([route('s', 'a', 'b', 'RED', 'A')]));
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain('doubleGroupInvalidSize');
  });

  it('rejects a triple whose members differ in length', () => {
    const res = validateContent(
      content([
        route('m1', 'a', 'b', 'RED', 'A', 2),
        route('m2', 'a', 'b', 'BLUE', 'A', 2),
        route('m3', 'a', 'b', 'GREEN', 'A', 3),
      ]),
    );
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.code)).toContain('doubleGroupLengthMismatch');
  });

  it('renders a 3-member group as three evenly spaced parallel tracks', () => {
    const { geometry } = buildRouteGeometryFor(
      [city('a', 0, 0), city('b', 10, 0)],
      [
        route('t1', 'a', 'b', 'RED', 'A'),
        route('t2', 'a', 'b', 'BLUE', 'A'),
        route('t3', 'a', 'b', 'GREEN', 'A'),
      ],
    );
    // perp offsets separate the three tracks; gaps are equal-and-opposite around 0.
    const perps = ['t1', 't2', 't3'].map((id) => geometry.get(id)!.perp);
    const signed = perps.map((p) => p.y); // chord is horizontal → nudge is along y
    const sorted = [...signed].sort((a, b) => a - b);
    expect(sorted[0]).toBeLessThan(0);
    expect(Math.abs(sorted[1]!)).toBeLessThan(1e-9); // middle track centred
    expect(sorted[2]).toBeGreaterThan(0);
    expect(Math.abs(sorted[0]! + sorted[2]!)).toBeLessThan(1e-9); // symmetric
  });
});
