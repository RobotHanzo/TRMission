/**
 * Canonical card / route colours for TRMission.
 *
 * CARD_COLORS is the FROZEN canonical iteration order — the engine must iterate
 * colours in this exact order everywhere (determinism, ADR A4). PURPLE is the 6th
 * colour (never "PINK"), consistent across proto / engine / art / map (ADR A12).
 */

/** The 8 train-card colours, in canonical order. */
export const TRAIN_COLORS = [
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'BLUE',
  'PURPLE',
  'BLACK',
  'WHITE',
] as const;
export type TrainColor = (typeof TRAIN_COLORS)[number];

/** Wild card. */
export const LOCOMOTIVE = 'LOCOMOTIVE' as const;

/** All 9 card kinds (8 colours + wild), frozen canonical order. */
export const CARD_COLORS = [
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'BLUE',
  'PURPLE',
  'BLACK',
  'WHITE',
  'LOCOMOTIVE',
] as const;
export type CardColor = (typeof CARD_COLORS)[number];

/** A route's colour requirement: a specific colour, or GRAY (any single colour). */
export type RouteColor = TrainColor | 'GRAY';

/** Valid route lengths on the Taiwan map (no length 5 or 7). */
export const ROUTE_LENGTHS = [1, 2, 3, 4, 6, 8] as const;
export type RouteLength = (typeof ROUTE_LENGTHS)[number];

/** A hand / discard pile, modelled as a colour-count multiset (cards are fungible). */
export type Hand = Readonly<Record<CardColor, number>>;

/** Seat index 0..4 — wire-level player identity. The visible seat palette is client-side (ADR A11). */
export type SeatIndex = 0 | 1 | 2 | 3 | 4;

export const isTrainColor = (c: string): c is TrainColor =>
  (TRAIN_COLORS as readonly string[]).includes(c);

export const isCardColor = (c: string): c is CardColor =>
  (CARD_COLORS as readonly string[]).includes(c);

/** An all-zero hand (one entry per card colour, in canonical order). */
export const emptyHand = (): Record<CardColor, number> => ({
  RED: 0,
  ORANGE: 0,
  YELLOW: 0,
  GREEN: 0,
  BLUE: 0,
  PURPLE: 0,
  BLACK: 0,
  WHITE: 0,
  LOCOMOTIVE: 0,
});
