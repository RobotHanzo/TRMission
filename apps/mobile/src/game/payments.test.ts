import { asRouteId, asCityId, CARD_COLORS } from '@trm/shared';
import type { RouteColor, RouteLength } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import {
  enumerateRoutePayments,
  enumerateStationPayments,
  routeShortfall,
  stationShortfall,
  handAfterPayment,
  type Hand,
  type Payment,
} from './payments';
import { enumerateTunnelExtra } from './tunnel';

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

  it('offers a zero-card payment only while the gala free-station window is up', () => {
    const empty = emptyHand();
    // Flag down + no cards ⇒ nothing on offer (the server would reject an empty payment).
    expect(enumerateStationPayments(empty, 2)).toHaveLength(0);
    // Flag up ⇒ a leading zero-payment even with an empty hand; choosing it sends {null,0,0}.
    const free = enumerateStationPayments(empty, 2, true);
    expect(free[0]).toEqual({ color: null, colorCount: 0, locomotives: 0 });
    // The zero option sits ALONGSIDE the normal paid options when the hand can also pay.
    const h = emptyHand();
    h.RED = 2;
    const withCards = enumerateStationPayments(h, 2, true);
    expect(withCards[0]).toEqual({ color: null, colorCount: 0, locomotives: 0 });
    expect(withCards.some((p) => p.color === 'RED' && p.colorCount === 2)).toBe(true);
  });
});

describe('sky-lantern surcharge (mirrors validateRoutePayment with extraCards = 1)', () => {
  it('demands length + 1 cards, with locomotives able to cover the surcharge', () => {
    const h = emptyHand();
    h.BLUE = 4;
    const ps = enumerateRoutePayments(h, route('BLUE', 3), 1);
    // Surcharged size = length + 1 = 4 cards.
    expect(ps).toContainEqual({ color: 'BLUE', colorCount: 4, locomotives: 0 });
    // A 3-blue payment (no surcharge) must NOT be offered while the surcharge is live.
    expect(ps.some((p) => p.colorCount + p.locomotives === 3)).toBe(false);
  });

  it('lets locomotives (wild) pay the surcharge', () => {
    const h = emptyHand();
    h.BLUE = 3;
    h.LOCOMOTIVE = 1;
    const ps = enumerateRoutePayments(h, route('BLUE', 3), 1);
    expect(ps).toContainEqual({ color: 'BLUE', colorCount: 3, locomotives: 1 });
  });

  it('is unaffordable when the hand only covers the base length', () => {
    const h = emptyHand();
    h.BLUE = 3;
    expect(enumerateRoutePayments(h, route('BLUE', 3), 1)).toHaveLength(0);
  });

  it('routeShortfall reports the inflated card need', () => {
    const h = emptyHand();
    h.BLUE = 3;
    expect(routeShortfall(h, route('BLUE', 3), 1)).toEqual({ kind: 'cards', need: 4, have: 3 });
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

describe('handAfterPayment', () => {
  it('subtracts the colour and locomotive cards spent', () => {
    const h = emptyHand();
    h.BLUE = 3;
    h.LOCOMOTIVE = 2;
    const after = handAfterPayment(h, { color: 'BLUE', colorCount: 2, locomotives: 1 });
    expect(after.BLUE).toBe(1);
    expect(after.LOCOMOTIVE).toBe(1);
  });

  it('treats a colourless (all-loco) payment as locomotives only', () => {
    const h = emptyHand();
    h.LOCOMOTIVE = 2;
    const after = handAfterPayment(h, { color: null, colorCount: 0, locomotives: 2 });
    expect(after.LOCOMOTIVE).toBe(0);
  });
});

describe('tunnel surcharge affordability (against the hand minus the base claim)', () => {
  it('excludes combos whose cards the base claim already consumed', () => {
    const h = emptyHand();
    h.BLUE = 4;
    const base: Payment = { color: 'BLUE', colorCount: 3, locomotives: 0 };
    // The full hand would wrongly offer a 2-blue surcharge…
    expect(enumerateTunnelExtra(h, 'BLUE', 2)).toContainEqual({
      color: 'BLUE',
      colorCount: 2,
      locomotives: 0,
    });
    // …but only 1 blue remains after the base payment, so nothing is affordable.
    expect(enumerateTunnelExtra(handAfterPayment(h, base), 'BLUE', 2)).toHaveLength(0);
  });

  it('still offers surcharges payable from the remainder', () => {
    const h = emptyHand();
    h.BLUE = 4;
    h.LOCOMOTIVE = 1;
    const base: Payment = { color: 'BLUE', colorCount: 3, locomotives: 0 };
    const opts = enumerateTunnelExtra(handAfterPayment(h, base), 'BLUE', 1);
    expect(opts).toContainEqual({ color: 'BLUE', colorCount: 1, locomotives: 0 });
    expect(opts).toContainEqual({ color: null, colorCount: 0, locomotives: 1 });
  });
});
