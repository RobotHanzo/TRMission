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
