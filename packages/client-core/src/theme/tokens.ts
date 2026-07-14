// TRMission chrome design tokens — "railway timetable on warm paper" — as TS values, the single
// source shared by both clients. apps/web renders them through styles/tokens.css (a parity test
// keeps the CSS in lockstep); apps/mobile consumes them directly via its useTheme() hook.
// Board-map colour TOKENS for cards/routes live in ./colors (canonical in @trm/map-data);
// this module is the app-chrome palette + spacing/radius scales.

export interface ChromeTokens {
  /** EMU blue (primary). */
  blue: string;
  /** Express ember (accent). */
  ember: string;
  /** Tutorial/encyclopedia accent (chips, progress, rings). */
  accent: string;
  /** Warm paper background. */
  paper: string;
  surface: string;
  surface2: string;
  ink: string;
  inkSoft: string;
  line: string;
  danger: string;
  ok: string;
  /** TRMISSION wordmark — the 台鐵任務 line stays orange in both themes. */
  brandNavy: string;
  // Cartography (board map)
  sea: string;
  seaLine: string;
  land: string;
  coast: string;
  relief: string;
}

export const LIGHT_TOKENS: ChromeTokens = {
  blue: '#0f5fa6',
  ember: '#ee6b1f',
  accent: '#2b6cb0',
  paper: '#f6f1e7',
  surface: '#fffdf8',
  surface2: '#efe8da',
  ink: '#1f2328',
  inkSoft: '#5b6168',
  line: '#d9d0be',
  danger: '#c0392b',
  ok: '#3a9d5c',
  brandNavy: '#17346f',
  sea: '#d6e4ec',
  seaLine: 'rgba(31, 90, 130, 0.2)',
  land: '#efe6cf',
  coast: '#b9a47b',
  relief: '#d9c9a1',
};

export const DARK_TOKENS: ChromeTokens = {
  ...LIGHT_TOKENS,
  paper: '#1a1c1f',
  surface: '#232629',
  surface2: '#2c2f33',
  ink: '#ececec',
  inkSoft: '#a8adb3',
  line: '#3a3e43',
  accent: '#5b9bd5', // brighter so chips/progress stay legible on dark surfaces
  brandNavy: '#5b9bd5', // same brightening — #17346f is too dark to read on dark surfaces
  sea: '#15222b',
  seaLine: 'rgba(150, 190, 215, 0.17)',
  land: '#2a2e25',
  coast: '#515a44',
  relief: '#39402e',
};

/** Corner radii (px / dp). */
export const RADIUS = { sm: 6, md: 10, lg: 16 } as const;

/** Spacing scale (px / dp) — mirrors --tr-space-N. */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;
