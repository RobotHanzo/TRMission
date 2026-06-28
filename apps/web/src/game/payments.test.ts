import { describe, it, expect } from 'vitest';
import { asRouteId, asCityId, CARD_COLORS } from '@trm/shared';
import type { RouteColor, RouteLength } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import {
  enumerateRoutePayments,
  enumerateStationPayments,
  routeShortfall,
  stationShortfall,
  type Hand,
} from './payments';

const emptyHand = (): Hand => Object.fromEntries(CARD_COLORS.map((c) => [c, 0])) as unknown as Hand;

const route = (
  color: RouteColor,
  length: RouteLength,
  ferryLocos = 0,
  isTunnel = false,
): RouteDef => ({
  id: asRouteId('R1'),
  a: asCityId('A'),
  b: asCityId('B'),
  color,
  length,
  ferryLocos,
  isTunnel,
});

describe('route payments', () => {
  it('matches colour + length with locomotives as wild', () => {
    const h = emptyHand();
    h.BLUE = 3;
    h.LOCOMOTIVE = 2;
    const ps = enumerateRoutePayments(h, route('BLUE', 3));
    expect(ps).toContainEqual({ color: 'BLUE', colorCount: 3, locomotives: 0 });
    expect(ps).toContainEqual({ color: 'BLUE', colorCount: 2, locomotives: 1 });
    expect(ps).toContainEqual({ color: 'BLUE', colorCount: 1, locomotives: 2 });
  });

  it('gray route accepts any single colour', () => {
    const h = emptyHand();
    h.RED = 2;
    h.GREEN = 2;
    const ps = enumerateRoutePayments(h, route('GRAY', 2));
    expect(ps.some((p) => p.color === 'RED')).toBe(true);
    expect(ps.some((p) => p.color === 'GREEN')).toBe(true);
  });

  it('ferry requires the minimum locomotives', () => {
    const h = emptyHand();
    h.RED = 4;
    h.LOCOMOTIVE = 1;
    expect(enumerateRoutePayments(h, route('GRAY', 4, 2))).toHaveLength(0);
    h.LOCOMOTIVE = 2;
    expect(enumerateRoutePayments(h, route('GRAY', 4, 2)).length).toBeGreaterThan(0);
  });

  it('returns nothing when unaffordable', () => {
    const h = emptyHand();
    h.BLUE = 1;
    expect(enumerateRoutePayments(h, route('BLUE', 3))).toHaveLength(0);
  });
});

describe('station payments', () => {
  it('any single colour covers the cost', () => {
    const h = emptyHand();
    h.RED = 2;
    expect(
      enumerateStationPayments(h, 2).some((p) => p.color === 'RED' && p.colorCount === 2),
    ).toBe(true);
  });
});

describe('route shortfall', () => {
  it('reports the colour need vs the best colour + locomotives', () => {
    const h = emptyHand();
    h.BLUE = 1;
    h.LOCOMOTIVE = 1;
    expect(routeShortfall(h, route('BLUE', 3))).toEqual({ kind: 'cards', need: 3, have: 2 });
  });

  it('reports the locomotive minimum when a ferry is short on locomotives', () => {
    const h = emptyHand();
    h.RED = 4;
    h.LOCOMOTIVE = 1;
    expect(routeShortfall(h, route('GRAY', 4, 2))).toEqual({ kind: 'locos', need: 2, have: 1 });
  });

  it('uses the strongest colour for a gray route', () => {
    const h = emptyHand();
    h.RED = 1;
    h.GREEN = 2;
    expect(routeShortfall(h, route('GRAY', 4))).toEqual({ kind: 'cards', need: 4, have: 2 });
  });

  it('agrees with the enumerator on the affordability boundary', () => {
    const h = emptyHand();
    h.BLUE = 2;
    h.LOCOMOTIVE = 1;
    const r = route('BLUE', 3);
    // have (3) >= need (3): the enumerator must offer at least one payment.
    expect(routeShortfall(h, r).have).toBeGreaterThanOrEqual(routeShortfall(h, r).need);
    expect(enumerateRoutePayments(h, r).length).toBeGreaterThan(0);
  });
});

describe('station shortfall', () => {
  it('reports the cost vs the best colour + locomotives', () => {
    const h = emptyHand();
    h.RED = 1;
    h.LOCOMOTIVE = 1;
    expect(stationShortfall(h, 3)).toEqual({ kind: 'cards', need: 3, have: 2 });
  });
});
