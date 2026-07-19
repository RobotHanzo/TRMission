import type { CardColor } from '@trm/shared';
import { ROUTE_COLOR_HEX, LIVERY_COLORS as MAP_LIVERY_COLORS } from '@trm/map-data';

// Original TRMission palette (NOT copied from any board game): EMU-blue primary +
// express-ember accent, with the 8 train colours chosen for distinct hue AND a
// luminance spread so they survive greyscale. The hexes themselves are canonical in
// @trm/map-data's render tokens (shared with the server's OG card); this module layers
// the web-only concerns on top: ink-on-colour, zh names, and the colour-blind glyphs.
export interface ColorToken {
  /** Engine card colour. */
  readonly key: CardColor;
  readonly hex: string;
  /** Readable ink colour on top of `hex`. */
  readonly ink: string;
  readonly nameZh: string;
  /** Non-colour fallback glyph (colour-blind mode). */
  readonly glyph: string;
}

export const CARD_COLOR_TOKENS: Record<CardColor, ColorToken> = {
  RED: { key: 'RED', hex: ROUTE_COLOR_HEX.RED, ink: '#FFFFFF', nameZh: '紅', glyph: '▲' },
  ORANGE: { key: 'ORANGE', hex: ROUTE_COLOR_HEX.ORANGE, ink: '#241300', nameZh: '橙', glyph: '◆' },
  YELLOW: { key: 'YELLOW', hex: ROUTE_COLOR_HEX.YELLOW, ink: '#241B00', nameZh: '黃', glyph: '●' },
  GREEN: { key: 'GREEN', hex: ROUTE_COLOR_HEX.GREEN, ink: '#FFFFFF', nameZh: '綠', glyph: '■' },
  BLUE: { key: 'BLUE', hex: ROUTE_COLOR_HEX.BLUE, ink: '#FFFFFF', nameZh: '藍', glyph: '♠' },
  PURPLE: { key: 'PURPLE', hex: ROUTE_COLOR_HEX.PURPLE, ink: '#FFFFFF', nameZh: '紫', glyph: '✦' },
  BLACK: { key: 'BLACK', hex: ROUTE_COLOR_HEX.BLACK, ink: '#FFFFFF', nameZh: '黑', glyph: '⬢' },
  WHITE: { key: 'WHITE', hex: ROUTE_COLOR_HEX.WHITE, ink: '#1B1C1E', nameZh: '白', glyph: '○' },
  // The wild card reads as "any colour" — themed as the rainbow locomotive (彩虹車頭).
  LOCOMOTIVE: {
    key: 'LOCOMOTIVE',
    hex: ROUTE_COLOR_HEX.LOCOMOTIVE,
    ink: '#13161A',
    nameZh: '彩虹車頭',
    glyph: '★',
  },
};

/** Gray routes (any single colour). */
export const GRAY_TOKEN = {
  hex: ROUTE_COLOR_HEX.GRAY,
  ink: '#1B1C1E',
  nameZh: '灰',
  glyph: '—',
} as const;

/**
 * The six locomotive liveries, in spectrum order — the "rainbow" that stands for the wild
 * LOCOMOTIVE card. Canonical in @trm/map-data (the OG card's ferry pips use the same list).
 */
export const LIVERY_COLORS = MAP_LIVERY_COLORS;

/**
 * Rainbow wash for the wild LOCOMOTIVE card (the six liveries) — so a face-up loco in the
 * card market reads as "any colour" rather than a flat grey chip.
 */
export const LOCOMOTIVE_GRADIENT = `linear-gradient(135deg, ${LIVERY_COLORS.join(', ')})`;

/** Seat colours — deliberately distinct from the 8 card colours (ADR A11). */
export const SEAT_COLORS = ['#0E8C8C', '#C0398B', '#E8A33D', '#5A6B7B', '#7CB342'] as const;

/** Celebration confetti palette + burst cadence (endgame scoreboard, ticket fanfare, finale). */
export const CONFETTI_COLORS = [
  '#e8732c',
  '#0f4c81',
  '#ffd76a',
  '#4caf50',
  '#9c27b0',
  '#e91e63',
] as const;
export const CONFETTI_INTERVAL_MS = 1800;

/** A seat index's display colour (wraps past 5 seats defensively). */
export const seatColor = (seat: number): string => SEAT_COLORS[seat % 5] ?? '#888';
