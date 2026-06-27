import type { CardColor } from '@trm/shared';

// Original TRMission palette (NOT copied from any board game): EMU-blue primary +
// express-ember accent, with the 8 train colours chosen for distinct hue AND a
// luminance spread so they survive greyscale. Each carries a glyph so colour-blind
// players can read routes by SHAPE, not hue (toggle `patternMode`).
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
  RED: { key: 'RED', hex: '#E4572E', ink: '#FFFFFF', nameZh: '紅', glyph: '▲' },
  ORANGE: { key: 'ORANGE', hex: '#EE7B30', ink: '#241200', nameZh: '橙', glyph: '◆' },
  YELLOW: { key: 'YELLOW', hex: '#F2C14E', ink: '#241B00', nameZh: '黃', glyph: '●' },
  GREEN: { key: 'GREEN', hex: '#3A9D5C', ink: '#FFFFFF', nameZh: '綠', glyph: '■' },
  BLUE: { key: 'BLUE', hex: '#0F5FA6', ink: '#FFFFFF', nameZh: '藍', glyph: '✚' },
  PURPLE: { key: 'PURPLE', hex: '#7B4DA6', ink: '#FFFFFF', nameZh: '紫', glyph: '✦' },
  BLACK: { key: 'BLACK', hex: '#2B2D31', ink: '#FFFFFF', nameZh: '黑', glyph: '⬢' },
  WHITE: { key: 'WHITE', hex: '#E8EAED', ink: '#1B1C1E', nameZh: '白', glyph: '○' },
  LOCOMOTIVE: { key: 'LOCOMOTIVE', hex: '#9AA0A6', ink: '#13161A', nameZh: '機', glyph: '★' },
};

/** Gray routes (any single colour). */
export const GRAY_TOKEN = { hex: '#B8BEC6', ink: '#1B1C1E', nameZh: '灰', glyph: '—' } as const;

/** Seat colours — deliberately distinct from the 8 card colours (ADR A11). */
export const SEAT_COLORS = ['#0E8C8C', '#C0398B', '#E8A33D', '#5A6B7B', '#7CB342'] as const;
