import { describe, it, expect } from 'vitest';
import { asRouteId, asCityId, CARD_COLORS } from '@trm/shared';
import type { RouteColor, RouteLength } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import { enumerateRoutePayments, enumerateStationPayments, type Hand } from './payments';

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
