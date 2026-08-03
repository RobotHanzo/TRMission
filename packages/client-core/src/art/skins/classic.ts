// The `classic` skin pack — the original hand-drawn train cards, kept as a skin after the
// authored rolling-stock sheets took over as the default (commit c7f0a8c replaced it outright).
//
// Clean-room vector work, nothing traced from any rulebook art: a vintage side-profile passenger
// carriage for the eight colours, and a steam locomotive for the wild LOCOMOTIVE card. The whole
// drawing is derived from a single card-colour hex, so every colour reads as the same vehicle in
// a different livery.
//
// This is written by hand rather than generated because the artwork IS the arithmetic below —
// there is no sheet to compile. It still emits the same `TrainCarArtwork` shape as the generated
// pack (`$n` ink placeholders, no CSS, `trm-`-prefixed def ids), which is what lets both clients
// render every pack through one code path. It had no night livery when it shipped and keeps
// none: `paletteDark` is the same palette, so a dark card looks exactly as it used to.
import { CARD_COLORS, type CardColor } from '@trm/shared';
import { CARD_COLOR_TOKENS } from '../../theme/colors';
import type { TrainCarArtSet, TrainCarArtwork } from '../types';

/* ── colour maths (lived in each app's theme/shade.ts before the artwork moved here) ────── */

type Rgb = readonly [number, number, number];

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

const parse = (hex: string): Rgb => {
  let h = hex.replace('#', '').trim();
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = ([r, g, b]: Rgb): string =>
  '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');

const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
};

/** Darken toward a warm near-black. */
const shade = (hex: string, t: number): string => mix(hex, '#16120c', t);
/** Lighten toward white. */
const tint = (hex: string, t: number): string => mix(hex, '#ffffff', t);
/** Relative luminance (0..1) — picks the light/dark glass tint per card colour. */
const luminance = (hex: string): number => {
  const [r, g, b] = parse(hex).map((v) => v / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Palettes are compared and swapped hex-for-hex, so every ink is normalised to lower-case
 *  6-digit form — the card tokens are authored upper-case, `shade`/`tint` emit lower. */
const ink = (hex: string): string => toHex(parse(hex));

const BLACK = '#000000';
const WHITE = '#ffffff';
/** Bogies, wheels and axleboxes — the one ink not derived from the livery. */
const METAL = '#2c2722';

/** viewBox is a fixed 132×72 so the card can scale the drawing freely. */
const VIEW_BOX = '0 0 132 72';

/* ── passenger carriage (the eight colours) ─────────────────────────────────────────────── */

const WINDOWS = [18, 36.5, 55, 73.5, 92];
const WHEELS = [30, 40, 92, 102];

function carriage(color: Exclude<CardColor, 'LOCOMOTIVE'>): TrainCarArtwork {
  const hex = CARD_COLOR_TOKENS[color].hex;
  // Pale glass on dark liveries, slightly tinted glass on light ones — keeps the windows
  // reading as glass against black/white cars alike.
  const glass = luminance(hex) > 0.6 ? shade(hex, 0.16) : tint(hex, 0.66);
  // $0 bodyTop  $1 body  $2 bodyBot  $3 glassTop  $4 glass  $5 black  $6 metal
  // $7 hub  $8 belt  $9 roofTop  $10 roof  $11 glassEdge  $12 lowerPanel
  const palette = [
    tint(hex, 0.26),
    ink(hex),
    shade(hex, 0.22),
    tint(glass, 0.34),
    glass,
    BLACK,
    METAL,
    tint(hex, 0.34),
    shade(hex, 0.4),
    shade(hex, 0.36),
    shade(hex, 0.5),
    shade(hex, 0.3),
    tint(hex, 0.18),
  ];
  const id = `trm-classic-${color.toLowerCase()}`;

  const body =
    `<defs>` +
    `<linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="$0"/><stop offset="0.55" stop-color="$1"/>` +
    `<stop offset="1" stop-color="$2"/></linearGradient>` +
    `<linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="$3"/><stop offset="1" stop-color="$4"/>` +
    `</linearGradient>` +
    `</defs>` +
    // ground shadow
    `<ellipse cx="66" cy="64.5" rx="52" ry="3.4" fill="$5" fill-opacity="0.16"/>` +
    // bogies
    `<g fill="$6"><rect x="24" y="50" width="22" height="5" rx="1.4"/>` +
    `<rect x="86" y="50" width="22" height="5" rx="1.4"/></g>` +
    // wheels
    WHEELS.map(
      (cx) =>
        `<circle cx="${cx}" cy="55" r="4.6" fill="$6"/><circle cx="${cx}" cy="55" r="1.7" fill="$7"/>`,
    ).join('') +
    // buffers
    `<circle cx="9.5" cy="44" r="1.7" fill="$8"/><circle cx="122.5" cy="44" r="1.7" fill="$8"/>` +
    // clerestory + main roof
    `<rect x="36" y="6" width="60" height="8" rx="3.4" fill="$9"/>` +
    `<rect x="14" y="11.5" width="104" height="9" rx="4.5" fill="$10"/>` +
    // body + underframe
    `<rect x="13" y="19" width="106" height="30" rx="4.2" fill="url(#${id}-body)"/>` +
    `<rect x="15" y="48" width="102" height="3.4" rx="1" fill="$8"/>` +
    // windows
    WINDOWS.map(
      (x) =>
        `<rect x="${x}" y="24" width="13.5" height="12" rx="2" fill="url(#${id}-glass)" ` +
        `stroke="$11" stroke-width="0.7"/>`,
    ).join('') +
    // belt line + lower-panel highlight
    `<line x1="15" y1="39.5" x2="117" y2="39.5" stroke="$8" stroke-width="1.1"/>` +
    `<rect x="16" y="41" width="100" height="5" rx="1.5" fill="$12" opacity="0.5"/>`;

  return {
    name: '客車廂',
    model: `${CARD_COLOR_TOKENS[color].nameZh}塗裝`,
    viewBox: VIEW_BOX,
    body,
    palette,
    paletteDark: palette,
  };
}

/* ── steam locomotive (the wild card) ───────────────────────────────────────────────────── */

/** Driving wheels + a leading wheel; the two drivers are coupled by a rod. */
const LOCO_WHEELS = [
  { cx: 52, r: 8.4 },
  { cx: 74, r: 8.4 },
  { cx: 97, r: 5 },
];
/** Wild = any colour: the six rainbow liveries as a strip on the footplate. */
const RAINBOW = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE'] as const;
const round = (n: number): string => String(Math.round(n * 1000) / 1000);

function locomotive(): TrainCarArtwork {
  const steel = CARD_COLOR_TOKENS.LOCOMOTIVE.hex; // neutral grey
  // $0 light  $1 steel  $2 mid  $3 dark  $4 hub  $5 cabGlass  $6 lamp  $7 white  $8 black
  // $9..$14 the six rainbow liveries
  const palette = [
    tint(steel, 0.4),
    ink(steel),
    shade(steel, 0.3),
    shade(steel, 0.62),
    tint(steel, 0.55),
    tint(steel, 0.62),
    tint(steel, 0.7),
    WHITE,
    BLACK,
    ...RAINBOW.map((c) => ink(CARD_COLOR_TOKENS[c].hex)),
  ];
  const id = 'trm-classic-locomotive';

  const body =
    `<defs><linearGradient id="${id}-boiler" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="$0"/><stop offset="0.5" stop-color="$1"/>` +
    `<stop offset="1" stop-color="$2"/></linearGradient></defs>` +
    `<ellipse cx="66" cy="64.5" rx="54" ry="3.4" fill="$8" fill-opacity="0.18"/>` +
    // cab (rear / left)
    `<rect x="12" y="13" width="30" height="30" rx="3" fill="url(#${id}-boiler)"/>` +
    `<rect x="12" y="11" width="30" height="5" rx="2" fill="$3"/>` +
    `<rect x="17" y="18" width="14" height="11" rx="2" fill="$5" stroke="$3" stroke-width="0.8"/>` +
    // boiler
    `<rect x="38" y="24" width="64" height="19" rx="9.5" fill="url(#${id}-boiler)"/>` +
    // polished sheen along the boiler + cab
    `<rect x="42" y="25.4" width="56" height="2.6" rx="1.3" fill="$7" fill-opacity="0.42"/>` +
    `<rect x="15" y="15" width="24" height="1.9" rx="1" fill="$7" fill-opacity="0.32"/>` +
    `<ellipse cx="99" cy="30" rx="2.4" ry="4.4" fill="$7" fill-opacity="0.28"/>` +
    // boiler bands
    [52, 66, 80]
      .map(
        (x) =>
          `<line x1="${x}" y1="25" x2="${x}" y2="42" stroke="$2" stroke-width="1" opacity="0.7"/>`,
      )
      .join('') +
    // smokebox front cap + headlamp
    `<circle cx="101" cy="33.5" r="9.6" fill="$2"/>` +
    `<circle cx="101" cy="33.5" r="9.6" fill="none" stroke="$3" stroke-width="1"/>` +
    `<circle cx="106" cy="28" r="2.2" fill="$6" stroke="$3" stroke-width="0.5"/>` +
    // chimney + steam dome
    `<path d="M86 24 L98 24 L95.5 11 L88.5 11 Z" fill="$3"/>` +
    `<rect x="86" y="9" width="13" height="3.5" rx="1.5" fill="$2"/>` +
    `<path d="M60 24 a7 7 0 0 1 14 0 Z" fill="$3"/>` +
    `<path d="M46 24 a5 5 0 0 1 10 0 Z" fill="$2"/>` +
    // running board + pilot (cowcatcher)
    `<rect x="30" y="43" width="78" height="3.6" rx="1" fill="$3"/>` +
    `<path d="M108 43 L118 56 L102 56 Z" fill="$2" stroke="$3" stroke-width="0.6"/>` +
    // wheels + spokes
    LOCO_WHEELS.map(
      ({ cx, r }) =>
        `<circle cx="${cx}" cy="54" r="${r}" fill="$3"/>` +
        `<circle cx="${cx}" cy="54" r="${round(r * 0.42)}" fill="$4"/>` +
        [0, 60, 120]
          .map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              `<line x1="${cx}" y1="54" x2="${round(cx + Math.cos(rad) * r * 0.78)}" ` +
              `y2="${round(54 + Math.sin(rad) * r * 0.78)}" stroke="$2" stroke-width="1"/>`
            );
          })
          .join(''),
    ).join('') +
    `<line x1="52" y1="54" x2="74" y2="54" stroke="$2" stroke-width="2.2" stroke-linecap="round"/>` +
    // wild-card rainbow livery strip, on the footplate under the cab
    `<g stroke="$8" stroke-opacity="0.28" stroke-width="0.3">` +
    RAINBOW.map(
      (_, i) =>
        `<rect x="${round(13 + i * 5.6)}" y="46.4" width="5" height="4.2" rx="0.8" fill="$${9 + i}"/>`,
    ).join('') +
    // glint across the strip
    `<rect x="13" y="46.6" width="33.6" height="1.1" rx="0.5" fill="$7" fill-opacity="0.45" ` +
    `stroke="none"/></g>`;

  return {
    name: '蒸汽機車',
    model: '彩虹塗裝',
    viewBox: VIEW_BOX,
    body,
    palette,
    paletteDark: palette,
  };
}

export const CLASSIC_ART: TrainCarArtSet = Object.fromEntries(
  CARD_COLORS.map((color) => [color, color === 'LOCOMOTIVE' ? locomotive() : carriage(color)]),
) as TrainCarArtSet;
