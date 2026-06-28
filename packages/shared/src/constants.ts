import type { CardColor } from './enums';
import { TRAIN_COLORS } from './enums';

/** Route-length → points (no length 5 or 7 exist on the map). */
export const SCORING_TABLE: Readonly<Record<number, number>> = Object.freeze({
  1: 1,
  2: 2,
  3: 4,
  4: 7,
  6: 15,
  8: 21,
});

/** Tunable rule parameters. Every game stores a resolved copy in its config. */
export interface RuleParams {
  trainCarsStart: number;
  stationsPerPlayer: number;
  handStart: number;
  marketSize: number;
  drawCount: number;
  /** If this many of the face-up cards are Locomotives, discard & redraw the market. */
  locoRecycleThreshold: number;
  tunnelRevealCount: number;
  endgameTrainThreshold: number;
  longestPathBonus: number;
  /** Points per unused (kept-in-supply) station at the end. */
  stationBonus: number;
  ticketDrawCount: number;
  minKeepInitial: number;
  minKeepNormal: number;
  /** Initial deal: how many long / short tickets each player is offered at setup. */
  initialLongOffer: number;
  initialShortOffer: number;
  deckPerColor: number;
  locomotiveCount: number;
  routePoints: Readonly<Record<number, number>>;
  /** Variant: a station may borrow ALL incident opponent routes (not just one), and ticket
   *  completion is recorded + scored the moment it connects. */
  unlimitedStationBorrow: boolean;
  /** Variant: a rainbow (LOCOMOTIVE) as the first BLIND draw does NOT end the draw. */
  secondDrawAfterBlindRainbow: boolean;
  /** Variant: unfinished destination tickets score 0 instead of subtracting their value. */
  noUnfinishedTicketPenalty: boolean;
}

export const DEFAULT_RULE_PARAMS: RuleParams = Object.freeze({
  trainCarsStart: 45,
  stationsPerPlayer: 3,
  handStart: 4,
  marketSize: 5,
  drawCount: 2,
  locoRecycleThreshold: 3,
  tunnelRevealCount: 3,
  endgameTrainThreshold: 2,
  longestPathBonus: 10,
  stationBonus: 4,
  ticketDrawCount: 3,
  minKeepInitial: 2,
  minKeepNormal: 1,
  initialLongOffer: 1,
  initialShortOffer: 3,
  deckPerColor: 12,
  locomotiveCount: 14,
  routePoints: SCORING_TABLE,
  unlimitedStationBorrow: false,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
});

/** Build the full deck composition as a colour-count multiset (e.g. 12 each colour + 14 loco = 110). */
export function buildDeckComposition(params: RuleParams = DEFAULT_RULE_PARAMS): Record<CardColor, number> {
  const comp = {} as Record<CardColor, number>;
  for (const c of TRAIN_COLORS) comp[c] = params.deckPerColor;
  comp.LOCOMOTIVE = params.locomotiveCount;
  return comp;
}

/** Total number of cards in a fresh deck. */
export function deckSize(params: RuleParams = DEFAULT_RULE_PARAMS): number {
  return TRAIN_COLORS.length * params.deckPerColor + params.locomotiveCount;
}
