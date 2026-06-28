import { TRAIN_COLORS, CARD_COLORS } from '@trm/shared';
import type { CardColor, TrainColor } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import { CardColor as PbCardColor, type CardCounts } from '@trm/proto';

export type Hand = Record<CardColor, number>;

export interface Payment {
  color: TrainColor | null;
  colorCount: number;
  locomotives: number;
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
 * the UI only ever offers payments the server will accept.
 */
export function enumerateRoutePayments(hand: Hand, route: RouteDef): Payment[] {
  const out: Payment[] = [];
  for (let loco = route.ferryLocos; loco <= route.length; loco++) {
    if (hand.LOCOMOTIVE < loco) continue;
    const colorCount = route.length - loco;
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
export function routeShortfall(hand: Hand, route: RouteDef): Shortfall {
  const locoHave = hand.LOCOMOTIVE;
  if (route.ferryLocos > locoHave) {
    return { kind: 'locos', need: route.ferryLocos, have: locoHave };
  }
  const bestColor =
    route.color === 'GRAY' ? Math.max(...TRAIN_COLORS.map((c) => hand[c])) : hand[route.color];
  return { kind: 'cards', need: route.length, have: bestColor + locoHave };
}

/** Why a station can't be built with this hand. Mirrors `enumerateStationPayments`. */
export function stationShortfall(hand: Hand, cost: number): Shortfall {
  const bestColor = Math.max(...TRAIN_COLORS.map((c) => hand[c]));
  return { kind: 'cards', need: cost, have: bestColor + hand.LOCOMOTIVE };
}

/** Station cost = (#stations already built) + 1, paid in one colour (locos wild). */
export function enumerateStationPayments(hand: Hand, cost: number): Payment[] {
  const out: Payment[] = [];
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
): { color: PbCardColor; colorCount: number; locomotives: number } => ({
  color: p.color ? TRAIN_TO_PB[p.color] : PbCardColor.UNSPECIFIED,
  colorCount: p.colorCount,
  locomotives: p.locomotives,
});
