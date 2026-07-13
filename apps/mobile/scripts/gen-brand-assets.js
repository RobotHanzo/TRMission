// TRMission mobile brand-asset generator. Renders the app's icon family + splash lockup from the
// ESTABLISHED web logo (apps/web/public/icon.svg): the rail-ticket mark — a white ticket with a
// perforation edge and a train-cab stamp — on the EMU-orange tile. This is the same artwork the web
// favicon uses, ported to the sizes/masks the native platforms want, so both clients share one mark.
//
//   node apps/mobile/scripts/gen-brand-assets.js
//
// Writes PNGs straight into ../assets/ (the files app.config.ts references). Rasterised with
// @resvg/resvg-js (hoisted at the repo root); system fonts carry the CJK wordmark on the splash.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ASSETS = path.join(__dirname, '..', 'assets');
const OUT = 1024; // master raster size; the OS/Expo down-scales from here

// Brand palette (matches apps/web/public/icon.svg exactly).
const ORANGE = '#E55509'; // EMU orange tile + ticket accents
const SHADOW = '#AE3C04'; // ticket drop-shadow
const WHITE = '#FFFFFF';
const DARK = '#410200'; // train baseline rule
const NAVY = '#17346f'; // splash wordmark (light)
const NAVY_DARK = '#5b9bd5'; // splash wordmark (dark)

// The web mark lives in a 120-unit box; scale it up to fill the 1024 master.
const S = (OUT / 120).toFixed(5);
const TICKET_BODY =
  'M26,36 L94,36 A8,8 0 0 1 102,44 L102,54 A6,6 0 0 0 102,66 L102,76 A8,8 0 0 1 94,84 ' +
  'L26,84 A8,8 0 0 1 18,76 L18,66 A6,6 0 0 0 18,54 L18,44 A8,8 0 0 1 26,36 Z';

// The train-cab stamp on the ticket, verbatim from the web logo (drawn mirrored). `fill` colours the
// cab, `windowFill` the two windows (kept solid inside a punched-out cab), `rule` the dark baseline.
const trainStamp = (fill, windowFill, rule) => `<g transform="translate(99,0) scale(-1,1)">
    <path d="M31,46 L48,46 C59,46 66,52 69.5,62 C70.8,65.8 68.5,68.5 64.5,68.5 L31,68.5 C28.2,68.5 27,67 27,64.5 L27,50 C27,47.5 28.2,46 31,46 Z" fill="${fill}"/>
    <rect x="32" y="50.5" width="10" height="8.5" rx="2" fill="${windowFill}"/>
    <path d="M47,50.5 C53,50.5 57,53.5 59.5,59 L47,59 Z" fill="${windowFill}"/>
    <line x1="29" y1="76" x2="68" y2="76" stroke="${rule}" stroke-width="4" stroke-linecap="round"/>
  </g>`;

/** The full-colour rail-ticket mark in 120-space (white ticket, orange accents, dark baseline). */
function ticket() {
  return `<g transform="rotate(-10 60 60)">
    <path d="${TICKET_BODY}" transform="translate(3,4)" fill="${SHADOW}"/>
    <path d="${TICKET_BODY}" fill="${WHITE}"/>
    <line x1="82" y1="42" x2="82" y2="78" stroke="${ORANGE}" stroke-width="2" stroke-dasharray="3 4"/>
    <circle cx="92" cy="50" r="4" fill="${ORANGE}"/>
    ${trainStamp(ORANGE, WHITE, DARK)}
  </g>`;
}

/** The monochrome mark: a solid white ticket silhouette with the perforation, notch and train-cab
 *  punched out as negative space (via a mask), so Android 13 themed icons tint a recognisable
 *  ticket rather than a featureless blob. White in the mask keeps pixels; black removes them. */
function monoMark() {
  return `<g transform="rotate(-10 60 60)">
    <mask id="ticket-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
      <path d="${TICKET_BODY}" fill="#fff"/>
      <line x1="82" y1="42" x2="82" y2="78" stroke="#000" stroke-width="2" stroke-dasharray="3 4"/>
      <circle cx="92" cy="50" r="4" fill="#000"/>
      ${trainStamp('#000', '#fff', '#000')}
    </mask>
    <path d="${TICKET_BODY}" fill="${WHITE}" mask="url(#ticket-cut)"/>
  </g>`;
}

/** The full logo badge (orange tile + ticket) at OUT scale. `rx` rounds the corners for a free-
 *  standing badge; 0 leaves it full-bleed for the iOS/store icon (the OS applies its own mask). */
function badge(rx) {
  return `<rect width="${OUT}" height="${OUT}" rx="${rx}" fill="${ORANGE}"/><g transform="scale(${S})">${ticket()}</g>`;
}

/** Scale a piece of OUT-space art about the centre by `k` (Android adaptive/monochrome safe zone). */
const safeZone = (k, body) =>
  `<g transform="translate(${OUT / 2} ${OUT / 2}) scale(${k}) translate(${-OUT / 2} ${-OUT / 2})">${body}</g>`;

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT}" height="${OUT}" viewBox="0 0 ${OUT} ${OUT}">${body}</svg>`;

const renderPng = (markup) =>
  new Resvg(markup, {
    fitTo: { mode: 'width', value: OUT },
    // Single bare CJK family: resvg falls through a comma-separated list to a kaiti fallback for
    // some glyphs. The wordmark is rasterised here and baked into the PNG, so this dev-machine
    // (Windows) font only needs to exist at generate time, never on the device.
    font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft JhengHei' },
  })
    .render()
    .asPng();

// The rounded badge pre-rasterised to a transparent PNG. resvg mis-matches CJK fonts when the
// mark's vector paths share an SVG with the wordmark text; embedding the badge as an inert <image>
// (below) sidesteps that. The badge has no text of its own, so it rasterises cleanly alone.
const badgeDataUri = `data:image/png;base64,${renderPng(svg(badge(230))).toString('base64')}`;

// Splash: the rounded badge above the bilingual wordmark, on a transparent field (app.config
// supplies the paper/dark background).
function splash(wordmarkHex) {
  const size = 430;
  const x = (OUT - size) / 2;
  return svg(`
    <image href="${badgeDataUri}" x="${x}" y="140" width="${size}" height="${size}"/>
    <text x="512" y="726" text-anchor="middle" font-family="Microsoft JhengHei" font-weight="700" font-size="128" letter-spacing="14" fill="${ORANGE}">台鐵任務</text>
    <text x="530" y="820" text-anchor="middle" font-family="Segoe UI" font-weight="700" font-size="58" letter-spacing="26" fill="${wordmarkHex}">TRMISSION</text>`);
}

const jobs = [
  // iOS/store icon — full-bleed orange tile (no rounding; the OS masks it).
  ['icon.png', svg(badge(0))],
  // Android adaptive foreground — the ticket alone in the ~66% safe zone (transparent; the config's
  // orange backgroundColor is the tile behind it).
  ['adaptive-icon.png', svg(safeZone(0.8, `<g transform="scale(${S})">${ticket()}</g>`))],
  // Android 13 themed (monochrome) icon — white-alpha ticket silhouette (train punched out), same
  // safe zone. The launcher tints the alpha to the wallpaper palette.
  [
    'adaptive-icon-monochrome.png',
    svg(safeZone(0.8, `<g transform="scale(${S})">${monoMark()}</g>`)),
  ],
  // Splash lockups (light + dark wordmark).
  ['splash-icon.png', splash(NAVY)],
  ['splash-icon-dark.png', splash(NAVY_DARK)],
];

for (const [name, markup] of jobs) {
  fs.writeFileSync(path.join(ASSETS, name), renderPng(markup));
  console.log(`wrote ${name}`);
}
