import { TRAIN_COLORS, CARD_COLORS } from '@trm/shared';
import type { CardColor, TrainColor } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import { BentoSpend as PbBentoSpend, CardColor as PbCardColor, type CardCounts } from '@trm/proto';

export type Hand = Record<CardColor, number>;

export interface Payment {
  color: TrainColor | null;
  colorCount: number;
  locomotives: number;
  /** Optional Bento Rush token use. Absent is the wire enum's UNSPECIFIED value. */
  bentoSpend?: 'WILD' | 'POINTS';
  /** Consume one Rolling-Stock claim-discount perk for this payment. */
  useClaimDiscount?: true;
  /** Presentation-only: this payment earns All Seats Reserved's +2 bonus. */
  allSeatsBonus?: true;
  /** Presentation-only: an empty repair payment consumes a repair permit. */
  repairPermit?: true;
}

export interface RoutePaymentModifiers {
  /** Number of Bento Rush tokens available to spend (only one may be spent per claim). */
  bentoTokens?: number;
  /** Number of one-use Rolling-Stock claim discounts available. */
  claimDiscounts?: number;
  /** Mark payments whose locomotive count exceeds the route's ferry minimum. */
  allSeatsReserved?: boolean;
}

/** Proto CardCounts → a colour→count hand map. */
export function handFromCounts(c: CardCounts | undefined): Hand {
  return {
    RED: c?.red ?? 0,
    ORANGE: c?.orange ?? 0,
    YELLOW: c?.yellow ?? 0,
    GREEN: c?.green ?? 0,
    BLUE: c?.blue ?? 0,
    PURPLE: c?.purple ?? 0,
    BLACK: c?.black ?? 0,
    WHITE: c?.white ?? 0,
    LOCOMOTIVE: c?.locomotive ?? 0,
  };
}

export const handTotal = (h: Hand): number => CARD_COLORS.reduce((n, c) => n + h[c], 0);

/**
 * The hand remaining after a payment's cards are set aside. Used to gate a follow-up spend that
 * must be afforded from what's LEFT — e.g. a tunnel surcharge, since the base claim cards stay in
 * hand until the tunnel resolves (engine spends base + surcharge together).
 */
export function handAfterPayment(hand: Hand, payment: Payment): Hand {
  const out = { ...hand };
  if (payment.color && payment.colorCount > 0)
    out[payment.color] = Math.max(0, out[payment.color] - payment.colorCount);
  out.LOCOMOTIVE = Math.max(0, out.LOCOMOTIVE - payment.locomotives);
  return out;
}

/**
 * Every legal payment for a route, given the hand — mirrors the engine's selector so
 * the UI only ever offers payments the server will accept. `extraCards` is the sky-lantern
 * surcharge (0 or 1): the player pays `route.length + extraCards` cards (same colour rules) but
 * still places only `route.length` cars — exactly as `validateRoutePayment` enforces server-side.
 */
export function enumerateRoutePayments(
  hand: Hand,
  route: RouteDef,
  extraCards = 0,
  modifiers: RoutePaymentModifiers = {},
): Payment[] {
  return enumerateRoutePaymentsWithModifiers(hand, route, extraCards, modifiers);
}

/**
 * Modifier-aware route-payment enumerator. It deliberately returns the normal payment alongside
 * every optional resource-spend variant so choosing a Bento/perk is always explicit in the modal.
 * Reductions lower the number of cards paid, never the route's train-car length or a ferry's
 * locomotive minimum. Bento POINTS keeps the normal price and is distinguished only on the wire.
 */
export function enumerateRoutePaymentsWithModifiers(
  hand: Hand,
  route: RouteDef,
  extraCards = 0,
  modifiers: RoutePaymentModifiers = {},
): Payment[] {
  const out: Payment[] = [];
  const spends: readonly {
    reduction: number;
    bentoSpend?: 'WILD' | 'POINTS';
    useClaimDiscount?: true;
  }[] = [
    { reduction: 0 },
    ...(modifiers.bentoTokens
      ? ([
          { reduction: 1, bentoSpend: 'WILD' as const },
          { reduction: 0, bentoSpend: 'POINTS' as const },
        ] as const)
      : []),
    ...(modifiers.claimDiscounts
      ? ([{ reduction: 1, useClaimDiscount: true as const }] as const)
      : []),
    ...(modifiers.bentoTokens && modifiers.claimDiscounts
      ? ([
          { reduction: 2, bentoSpend: 'WILD' as const, useClaimDiscount: true as const },
          { reduction: 1, bentoSpend: 'POINTS' as const, useClaimDiscount: true as const },
        ] as const)
      : []),
  ];

  for (const spend of spends) {
    const required = Math.max(0, route.length + extraCards - spend.reduction);
    // A card-count discount never waives a ferry's printed locomotive minimum.
    if (required < route.ferryLocos) continue;
    for (let loco = route.ferryLocos; loco <= required; loco++) {
      if (hand.LOCOMOTIVE < loco) continue;
      const colorCount = required - loco;
      const flags = {
        ...(spend.bentoSpend ? { bentoSpend: spend.bentoSpend } : {}),
        ...(spend.useClaimDiscount ? { useClaimDiscount: true as const } : {}),
        ...(modifiers.allSeatsReserved && loco > route.ferryLocos
          ? { allSeatsBonus: true as const }
          : {}),
      };
      if (colorCount === 0) {
        out.push({ color: null, colorCount: 0, locomotives: loco, ...flags });
        continue;
      }
      if (route.color === 'GRAY') {
        for (const c of TRAIN_COLORS)
          if (hand[c] >= colorCount)
            out.push({ color: c, colorCount, locomotives: loco, ...flags });
      } else if (hand[route.color] >= colorCount) {
        out.push({ color: route.color, colorCount, locomotives: loco, ...flags });
      }
    }
  }
  return out;
}

/** Two matching cards to repair, plus an explicit empty permit option when one is held. */
export function enumerateRepairPayments(hand: Hand, repairPermits = 0): Payment[] {
  const out = enumerateStationPayments(hand, 2);
  if (repairPermits > 0)
    out.unshift({ color: null, colorCount: 0, locomotives: 0, repairPermit: true });
  return out;
}

/**
 * Every legal payment to repair a broken rail (斷軌): exactly `route.brokenCarriages` cards of
 * the route's colour (gray: any single colour), locomotives wild — mirrors the engine's
 * `validateBrokenRailPayment` (no ferry minimum, no train-car requirement, no claim modifiers).
 */
export function enumerateBrokenRailPayments(hand: Hand, route: RouteDef): Payment[] {
  const required = route.brokenCarriages ?? 0;
  if (required <= 0) return [];
  const out: Payment[] = [];
  for (let loco = 0; loco <= required; loco++) {
    if (hand.LOCOMOTIVE < loco) continue;
    const colorCount = required - loco;
    if (colorCount === 0) {
      out.push({ color: null, colorCount: 0, locomotives: loco });
      continue;
    }
    if (route.color === 'GRAY') {
      for (const c of TRAIN_COLORS)
        if (hand[c] >= colorCount) out.push({ color: c, colorCount, locomotives: loco });
    } else if (hand[route.color] >= colorCount) {
      out.push({ color: route.color, colorCount, locomotives: loco });
    }
  }
  return out;
}

/** Why a broken rail can't be repaired with this hand. Mirrors `enumerateBrokenRailPayments`. */
export function brokenRailShortfall(hand: Hand, route: RouteDef): Shortfall {
  const bestColor =
    route.color === 'GRAY' ? Math.max(...TRAIN_COLORS.map((c) => hand[c])) : hand[route.color];
  return {
    kind: 'cards',
    need: route.brokenCarriages ?? 0,
    have: bestColor + hand.LOCOMOTIVE,
  };
}

export interface Shortfall {
  /** `locos` = a ferry's locomotive minimum isn't met; `cards` = not enough matching cards. */
  kind: 'cards' | 'locos';
  /** How many are required. */
  need: number;
  /** How many usable cards the hand can put toward it. */
  have: number;
}

/**
 * Why a route can't be claimed with this hand. Mirrors `enumerateRoutePayments` — only
 * meaningful when that returns no payment. Locomotives are wild, so `have` for a colour
 * shortfall is the best single colour plus every locomotive.
 */
export function routeShortfall(hand: Hand, route: RouteDef, extraCards = 0): Shortfall {
  const locoHave = hand.LOCOMOTIVE;
  if (route.ferryLocos > locoHave) {
    return { kind: 'locos', need: route.ferryLocos, have: locoHave };
  }
  const bestColor =
    route.color === 'GRAY' ? Math.max(...TRAIN_COLORS.map((c) => hand[c])) : hand[route.color];
  return { kind: 'cards', need: route.length + extraCards, have: bestColor + locoHave };
}

/** Why a station can't be built with this hand. Mirrors `enumerateStationPayments`. */
export function stationShortfall(hand: Hand, cost: number): Shortfall {
  const bestColor = Math.max(...TRAIN_COLORS.map((c) => hand[c]));
  return { kind: 'cards', need: cost, have: bestColor + hand.LOCOMOTIVE };
}

/**
 * Station cost = (#stations already built) + 1, paid in one colour (locos wild). When `freeStation`
 * is set (an active railway-gala window) a zero-card payment is offered first — the engine accepts
 * an empty payment ONLY while that flag is up, so the option must never appear otherwise.
 */
export function enumerateStationPayments(hand: Hand, cost: number, freeStation = false): Payment[] {
  const out: Payment[] = [];
  if (freeStation) out.push({ color: null, colorCount: 0, locomotives: 0 });
  for (let loco = 0; loco <= cost; loco++) {
    if (hand.LOCOMOTIVE < loco) continue;
    const colorCount = cost - loco;
    if (colorCount === 0) {
      out.push({ color: null, colorCount: 0, locomotives: loco });
      continue;
    }
    for (const c of TRAIN_COLORS)
      if (hand[c] >= colorCount) out.push({ color: c, colorCount, locomotives: loco });
  }
  return out;
}

const TRAIN_TO_PB: Record<TrainColor, PbCardColor> = {
  RED: PbCardColor.RED,
  ORANGE: PbCardColor.ORANGE,
  YELLOW: PbCardColor.YELLOW,
  GREEN: PbCardColor.GREEN,
  BLUE: PbCardColor.BLUE,
  PURPLE: PbCardColor.PURPLE,
  BLACK: PbCardColor.BLACK,
  WHITE: PbCardColor.WHITE,
};

/** Client Payment → the proto Payment init shape the socket sends. */
export const paymentToProto = (
  p: Payment,
): {
  color: PbCardColor;
  colorCount: number;
  locomotives: number;
  bentoSpend: PbBentoSpend;
  useClaimDiscount: boolean;
} => ({
  color: p.color ? TRAIN_TO_PB[p.color] : PbCardColor.UNSPECIFIED,
  colorCount: p.colorCount,
  locomotives: p.locomotives,
  bentoSpend:
    p.bentoSpend === 'WILD'
      ? PbBentoSpend.WILD
      : p.bentoSpend === 'POINTS'
        ? PbBentoSpend.POINTS
        : PbBentoSpend.UNSPECIFIED,
  useClaimDiscount: p.useClaimDiscount ?? false,
});
