// Shared cartography render tokens — the visual constants behind the board's rendering,
// extracted so the web board CSS (apps/web/src/styles/game.css, via mapCssVars()) and the
// server's OG map card (apps/server/src/og/map-svg.ts) draw from ONE definition and can
// never drift. Pure data: nothing here touches the authored content tables, so CONTENT_HASH
// is unaffected. Dimensions are in board units at base zoom (--inv-scale / --marker-scale = 1).

/** The themed cartography palette (mirrored 1:1 by tokens.css's --tr-* custom properties —
 *  a parity test in apps/web enforces the mirror, since CSS theming can't import TS). */
export interface MapPalette {
  readonly sea: string;
  readonly seaLine: string;
  readonly land: string;
  readonly coast: string;
  readonly relief: string;
  readonly surface: string;
  readonly ink: string;
  readonly blue: string;
}

export const MAP_PALETTE_LIGHT: MapPalette = {
  sea: '#d6e4ec',
  seaLine: 'rgba(31, 90, 130, 0.2)',
  land: '#efe6cf',
  coast: '#b9a47b',
  relief: '#d9c9a1',
  surface: '#fffdf8',
  ink: '#1f2328',
  blue: '#0f5fa6',
};

export const MAP_PALETTE_DARK: MapPalette = {
  sea: '#15222b',
  seaLine: 'rgba(150, 190, 215, 0.17)',
  land: '#2a2e25',
  coast: '#515a44',
  relief: '#39402e',
  surface: '#232629',
  ink: '#ececec',
  // tokens.css does not override --tr-blue in dark mode; the EMU blue carries through.
  blue: '#0f5fa6',
};

/** Theme-independent inks (identical in light and dark board CSS). */
export const MAP_INKS = {
  /** Car slot / ferry pip outline. */
  carEdge: '#2a2520',
  /** Tunnel sleeper tie fill. */
  tie: '#3d352b',
  tieOpacity: 0.9,
  /** The wide faint glint behind a tunnel's ties. */
  tunnelBg: '#b0b0b0',
  tunnelBgOpacity: 0.18,
  /** Dotted open-sea ferry crossing. */
  ferryLine: '#9aa0a6',
  /** White ring around a ferry's rainbow locomotive pips. */
  ferryLocoEdge: '#fff',
} as const;

/** The 8 train colours + GRAY + the wild locomotive — canonical hexes. The web's
 *  CARD_COLOR_TOKENS (glyphs, ink-on-colour, zh names) builds on these. */
export const ROUTE_COLOR_HEX = {
  RED: '#D72631',
  ORANGE: '#EE7B30',
  YELLOW: '#F2C14E',
  GREEN: '#3A9D5C',
  BLUE: '#0F5FA6',
  PURPLE: '#7B4DA6',
  BLACK: '#2B2D31',
  WHITE: '#E8EAED',
  LOCOMOTIVE: '#9AA0A6',
  GRAY: '#8A8E96',
} as const;

/** The six locomotive liveries in spectrum order — the wild "rainbow" (ferry pips, loco card wash). */
export const LIVERY_COLORS: readonly string[] = (
  ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE'] as const
).map((k) => ROUTE_COLOR_HEX[k]);

/** Every shared map dimension, in board units at base zoom. */
export const MAP_DIMS = {
  // Roadbed under the cars.
  bedW: 2.8,
  bedOwnedW: 3.1,
  bedOpacity: 0.95,
  // Car slots (x/width along the path come from geometry; these are the across-track props).
  slotH: 1.44,
  slotRx: 0.42,
  slotStrokeW: 0.3,
  slotOwnedStrokeW: 0.42,
  // Tunnels: wide faint glint + diagonal sleeper ties.
  tunnelBgW: 6,
  tieW: 8,
  tieH: 0.28,
  // Ferries: dotted crossing + round pips + rainbow loco rects.
  ferryLineW: 0.5,
  ferryDash: '0.1 2.55',
  ferryPipR: 0.7,
  ferryPipStrokeW: 0.25,
  ferryLocoStrokeW: 0.5,
  // Interaction + colour-blind aid.
  hitW: 4.2,
  glyphR: 1.6,
  glyphStrokeW: 0.22,
  // City markers.
  cityR: 1.15,
  islandR: 1.4,
  cityStrokeW: 0.4,
  hubW: 2.5,
  hubH: 1.6,
  hubRx: 0.8,
  // Cartography.
  graticuleW: 0.32,
  graticuleDashA: 0.9,
  graticuleDashB: 1.7,
  landStrokeW: 0.45,
  landSurfW: 2.4,
  landSurfOpacity: 0.6,
  geoIslandStrokeW: 0.4,
  reliefOpacity: 0.55,
  reliefRidgeW: 0.3,
  reliefRidgeDash: '0.5 0.9',
  // Cosmetic political border overlay for a custom map's picked countries (see
  // MapGeography.borders) — dashed so it reads distinctly from the solid coastline stroke.
  countryBorderW: 0.35,
  countryBorderDash: '1.1 0.7',
  countryBorderOpacity: 0.85,
} as const;

/**
 * The dimensions as CSS custom properties for the board stylesheet. game.css reads ONLY these
 * vars for its map dimensions (no literals), so the web board and the OG card cannot drift.
 * MapScene pins them on its <svg> root; the standalone tutorial specimens spread them too.
 */
export function mapCssVars(): Record<string, string> {
  const D = MAP_DIMS;
  return {
    '--m-grat-w': String(D.graticuleW),
    '--m-grat-dash-a': String(D.graticuleDashA),
    '--m-grat-dash-b': String(D.graticuleDashB),
    '--m-land-surf-w': String(D.landSurfW),
    '--m-land-surf-o': String(D.landSurfOpacity),
    '--m-land-stroke-w': String(D.landStrokeW),
    '--m-geo-island-w': String(D.geoIslandStrokeW),
    '--m-relief-o': String(D.reliefOpacity),
    '--m-relief-ridge-w': String(D.reliefRidgeW),
    '--m-relief-ridge-dash': D.reliefRidgeDash,
    '--m-border-w': String(D.countryBorderW),
    '--m-border-dash': D.countryBorderDash,
    '--m-border-o': String(D.countryBorderOpacity),
    '--m-bed-w': String(D.bedW),
    '--m-bed-o': String(D.bedOpacity),
    '--m-bed-owned-w': String(D.bedOwnedW),
    '--m-slot-h': String(D.slotH),
    '--m-slot-rx': String(D.slotRx),
    '--m-slot-stroke-w': String(D.slotStrokeW),
    '--m-slot-owned-stroke-w': String(D.slotOwnedStrokeW),
    '--m-car-edge': MAP_INKS.carEdge,
    '--m-tunnel-bg-w': String(D.tunnelBgW),
    '--m-tunnel-bg-ink': MAP_INKS.tunnelBg,
    '--m-tunnel-bg-o': String(MAP_INKS.tunnelBgOpacity),
    '--m-tie-w': String(D.tieW),
    '--m-tie-h': String(D.tieH),
    '--m-tie-ink': MAP_INKS.tie,
    '--m-tie-o': String(MAP_INKS.tieOpacity),
    '--m-ferry-line-w': String(D.ferryLineW),
    '--m-ferry-line-ink': MAP_INKS.ferryLine,
    '--m-ferry-dash': D.ferryDash,
    '--m-ferry-pip-r': String(D.ferryPipR),
    '--m-ferry-pip-stroke-w': String(D.ferryPipStrokeW),
    '--m-ferry-loco-stroke-w': String(D.ferryLocoStrokeW),
    '--m-ferry-loco-edge': MAP_INKS.ferryLocoEdge,
    '--m-hit-w': String(D.hitW),
    '--m-glyph-r': String(D.glyphR),
    '--m-glyph-stroke-w': String(D.glyphStrokeW),
    '--m-city-r': String(D.cityR),
    '--m-island-r': String(D.islandR),
    '--m-city-stroke-w': String(D.cityStrokeW),
    '--m-hub-w': String(D.hubW),
    '--m-hub-h': String(D.hubH),
    '--m-hub-rx': String(D.hubRx),
  };
}
