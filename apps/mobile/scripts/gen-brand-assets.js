// TRMission mobile brand-asset generator. Renders the app's icon family + splash lockup from the
// ESTABLISHED web logo (apps/web/public/icon.svg): the rail-ticket mark — a white ticket with a
// perforation edge and a train-cab stamp — on the EMU-orange tile. This is the same artwork the web
// favicon uses, ported to the sizes/masks the native platforms want, so both clients share one mark.
//
// iOS ships a REAL Liquid Glass icon: assets/TRMission.icon, an Icon Composer bundle this script
// hand-authors (icon.json + a transparent 1024px ticket layer). The bundle format is just a folder
// of JSON + images, so no Mac / Icon Composer GUI is needed to WRITE it — only Xcode 26's actool
// (the mobile-ios.yml runner) can COMPILE it, rendering true glass for iOS 26 and flattened
// fallbacks for older iOS. This replaced the flat light/dark/tinted PNG trio because iOS 26 wraps
// legacy flat icons in its own glass slab — inset, re-masked and frosted — which is what made the
// springboard icon look compressed/low-quality. Schema notes: fill-specializations carries the
// per-appearance tile (dark = the 'system-dark' preset — Icon Composer's "System Dark" fill, the
// same dark-grey glass gradient every system app sits on; a hand-picked solid black looked
// unnaturally void next to them on the springboard); the layer is a PNG, not an SVG, because SVG
// layers don't receive the glass treatment (Apple bug FB18097334); the system derives the
// tinted/mono appearance from the layer's luminance on its own.
//
// The flat trio (icon-dark.png / icon-tinted.png + icon.png) is still generated as the documented
// fallback — if actool ever rejects the bundle, point app.config.ts's ios.icon back at it. Its
// dark tile bakes Apple's dark-icon template gradient (#313131→#141414) so the fallback matches
// the bundle's system-dark appearance (baked, not transparent, so it looks right even if some
// pipeline flattens the PNG as opaque full-bleed).
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

// Per-appearance palettes for the iOS icon trio (see header comment). `tile`/`ticketShadow` colour
// the badge's background + the ticket's drop-shadow; `ticketBody` the ticket paper itself; `accent`
// the perforation dash + rivet drawn on the ticket; `cabFill`/`windowFill`/`rule` the train stamp.
const PALETTE_BRAND = {
  tile: ORANGE,
  ticketShadow: SHADOW,
  ticketBody: WHITE,
  accent: ORANGE,
  cabFill: ORANGE,
  windowFill: WHITE,
  rule: DARK,
};
// Dark appearance: Apple's dark-icon template gradient (top #313131 → bottom #141414) — the same
// dark-grey tile the system composites behind its own dark icons, and the flat-trio stand-in for
// the .icon bundle's 'system-dark' fill. Never pure black: next to system apps a #000 tile reads
// as an unnatural void. `tile: [top, bottom]` renders as a vertical gradient in badge().
// The baked drop-shadow drops to a whisper of warm brown so the ticket still lifts off the dark tile.
const PALETTE_DARK = {
  ...PALETTE_BRAND,
  tile: ['#313131', '#141414'],
  ticketShadow: '#3a1502',
};
// De-hued for the Liquid Glass "tinted" slot: the system recolours this with the user's chosen
// tint + glass specular, so shape/luminosity contrast is what matters, not the brand's orange.
const PALETTE_TINTED = {
  tile: '#707070',
  ticketShadow: '#3a3a3a',
  ticketBody: WHITE,
  accent: '#707070',
  cabFill: '#4a4a4a',
  windowFill: WHITE,
  rule: '#1f1f1f',
};

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

/** The rail-ticket mark in 120-space, coloured by `p` (defaults to the brand palette: white ticket,
 *  orange accents, dark baseline — matches apps/web/public/icon.svg exactly). `shadow: false` drops
 *  the baked drop-shadow for the Liquid Glass layer, where the glass system casts a real one. */
function ticket(p = PALETTE_BRAND, { shadow = true } = {}) {
  return `<g transform="rotate(-10 60 60)">
    ${shadow ? `<path d="${TICKET_BODY}" transform="translate(3,4)" fill="${p.ticketShadow}"/>` : ''}
    <path d="${TICKET_BODY}" fill="${p.ticketBody}"/>
    <line x1="82" y1="42" x2="82" y2="78" stroke="${p.accent}" stroke-width="2" stroke-dasharray="3 4"/>
    <circle cx="92" cy="50" r="4" fill="${p.accent}"/>
    ${trainStamp(p.cabFill, p.windowFill, p.rule)}
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

/** The full logo badge (tile + ticket) at OUT scale, coloured by `p`. `rx` rounds the corners for a
 *  free-standing badge; 0 leaves it full-bleed for the iOS/store icon (the OS applies its own mask).
 *  `p.tile` is a solid colour, or a `[top, bottom]` pair for a vertical-gradient tile (dark trio). */
function badge(rx, p = PALETTE_BRAND) {
  const tile = Array.isArray(p.tile)
    ? `<defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${p.tile[0]}"/><stop offset="1" stop-color="${p.tile[1]}"/>
      </linearGradient></defs><rect width="${OUT}" height="${OUT}" rx="${rx}" fill="url(#tile)"/>`
    : `<rect width="${OUT}" height="${OUT}" rx="${rx}" fill="${p.tile}"/>`;
  return `${tile}<g transform="scale(${S})">${ticket(p)}</g>`;
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

// Splash: just the badge mark, centred on a transparent field (app.config supplies the
// paper/dark background). Light and dark variants are identical — the mark itself doesn't
// change with theme, only the backgroundColor app.config sets behind it.
function splash() {
  const size = 512;
  const x = (OUT - size) / 2;
  const y = (OUT - size) / 2;
  return svg(`<image href="${badgeDataUri}" x="${x}" y="${y}" width="${size}" height="${size}"/>`);
}

/** #rrggbb → Icon Composer's colour syntax (sRGB components, 5-decimal, alpha always 1). */
function srgb(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return `srgb:${r.toFixed(5)},${g.toFixed(5)},${b.toFixed(5)},1.00000`;
}

/** The iOS 26 Icon Composer bundle (see header): Assets/ticket.png is the mark alone on
 *  transparency — no tile (icon.json's fill IS the tile) and no baked drop-shadow (the glass
 *  system casts a dynamic one, configured on the group). Xcode 26's actool compiles it; the
 *  system supplies the specular pass, the dark springboard swap and the tinted/mono rendering. */
function writeIconBundle() {
  const bundle = path.join(ASSETS, 'TRMission.icon');
  fs.mkdirSync(path.join(bundle, 'Assets'), { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'Assets', 'ticket.png'),
    renderPng(svg(`<g transform="scale(${S})">${ticket(PALETTE_BRAND, { shadow: false })}</g>`)),
  );
  const manifest = {
    // Per-appearance tile: brand orange by default; in dark mode the 'system-dark' fill preset —
    // the bare-string serialization Icon Composer itself writes (verified against shipping .icon
    // bundles, e.g. UTM's) for the system's standard dark-grey glass gradient, so the dark tile
    // matches the built-in apps exactly instead of hand-approximating (or flattening to #000).
    'fill-specializations': [
      { value: { solid: srgb(ORANGE) } },
      { appearance: 'dark', value: 'system-dark' },
    ],
    groups: [
      {
        name: 'ticket',
        layers: [{ 'image-name': 'ticket.png', name: 'ticket', glass: true }],
        shadow: { kind: 'neutral', opacity: 0.5 },
        specular: true,
      },
    ],
    // Square icons on every platform this app ships; no watchOS, so no circles entry.
    'supported-platforms': { squares: 'shared' },
  };
  fs.writeFileSync(path.join(bundle, 'icon.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('wrote TRMission.icon (icon.json + Assets/ticket.png)');
}

const jobs = [
  // Root icon (Android legacy + web-harness favicon) — full-bleed orange tile, no rounding (the OS
  // masks it). Also the `light` slot of the flat-PNG iOS fallback trio (see header).
  ['icon.png', svg(badge(0, PALETTE_BRAND))],
  // Fallback trio `dark` slot — solid-black tile, same mark as the .icon bundle's dark appearance.
  ['icon-dark.png', svg(badge(0, PALETTE_DARK))],
  // Fallback trio `tinted` slot — de-hued so the system's own tint + glass pass reads cleanly.
  ['icon-tinted.png', svg(badge(0, PALETTE_TINTED))],
  // Android adaptive foreground — the ticket alone in the ~66% safe zone (transparent; the config's
  // orange backgroundColor is the tile behind it).
  ['adaptive-icon.png', svg(safeZone(0.8, `<g transform="scale(${S})">${ticket()}</g>`))],
  // Android 13 themed (monochrome) icon — white-alpha ticket silhouette (train punched out), same
  // safe zone. The launcher tints the alpha to the wallpaper palette.
  [
    'adaptive-icon-monochrome.png',
    svg(safeZone(0.8, `<g transform="scale(${S})">${monoMark()}</g>`)),
  ],
  // Splash lockups — logo mark only, no wordmark text (light/dark are the same artwork).
  ['splash-icon.png', splash()],
  ['splash-icon-dark.png', splash()],
];

for (const [name, markup] of jobs) {
  fs.writeFileSync(path.join(ASSETS, name), renderPng(markup));
  console.log(`wrote ${name}`);
}
writeIconBundle();

// Bottom-tab-bar glyphs (navigation/HomeTabs.tsx) — Android + the web-harness fallback only; iOS
// uses SF Symbols directly (zero asset cost), see HomeTabs.tsx. Simple ORIGINAL geometric
// silhouettes authored in a standard 24-unit icon grid, not vendor icon-set path data (same
// original-artwork stance as the rest of the brand kit). Solid black on transparent: the tab
// navigator re-tints them (`tabBarIconRenderingMode: 'automatic'`), so the source colour is inert —
// only the alpha silhouette matters.
const TAB_ICON_OUT = 256;
const tabIconSvg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${TAB_ICON_OUT}" height="${TAB_ICON_OUT}" viewBox="0 0 24 24">${body}</svg>`;

/** Roof + walls + a punched-out door notch, one continuous outline. */
function houseGlyph() {
  return `<path d="M12 3 L21 11 L18.5 11 L18.5 20 L13.5 20 L13.5 14 L10.5 14 L10.5 20 L5.5 20 L5.5 11 L3 11 Z" fill="#000"/>`;
}

/** Two facing pages + a masked-transparent spine crease down the middle. */
function bookGlyph() {
  const pages =
    'M12 5.5 C10 4.3 6.5 3.7 3 4.2 L3 17.2 C6.5 16.7 10 17.3 12 18.5 ' +
    'C14 17.3 17.5 16.7 21 17.2 L21 4.2 C17.5 3.7 14 4.3 12 5.5 Z';
  return `<mask id="book-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <path d="${pages}" fill="#fff"/>
      <line x1="12" y1="5.3" x2="12" y2="18.5" stroke="#000" stroke-width="0.9"/>
    </mask>
    <path d="${pages}" fill="#000" mask="url(#book-cut)"/>`;
}

/** Cup bowl + stem + base, with two stroked handle arcs either side. */
function trophyGlyph() {
  return `<path d="M6 4 L18 4 L17 10.5 C17 13.5 14.8 15 12 15 C9.2 15 7 13.5 7 10.5 Z" fill="#000"/>
    <rect x="11" y="15" width="2" height="3" fill="#000"/>
    <rect x="8" y="18" width="8" height="2" rx="1" fill="#000"/>
    <path d="M6 5 C2.5 5 2.5 10 6.5 10.5" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M18 5 C21.5 5 21.5 10 17.5 10.5" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
}

/** A ring of 8 teeth (rotated copies of one tooth rect) around a circle, centre punched out. */
function gearGlyph() {
  const teeth = Array.from(
    { length: 8 },
    (_, i) =>
      `<rect x="10.7" y="1" width="2.6" height="5" rx="1" transform="rotate(${(i * 360) / 8} 12 12)" fill="#fff"/>`,
  ).join('');
  return `<mask id="gear-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <circle cx="12" cy="12" r="9" fill="#fff"/>
      ${teeth}
      <circle cx="12" cy="12" r="3.2" fill="#000"/>
    </mask>
    <rect x="0" y="0" width="24" height="24" fill="#000" mask="url(#gear-cut)"/>`;
}

function writeTabIcons() {
  const dir = path.join(ASSETS, 'tabs');
  fs.mkdirSync(dir, { recursive: true });
  const glyphs = [
    ['home.png', houseGlyph()],
    ['encyclopedia.png', bookGlyph()],
    ['leaderboard.png', trophyGlyph()],
    ['settings.png', gearGlyph()],
  ];
  for (const [name, body] of glyphs) {
    fs.writeFileSync(path.join(dir, name), renderPng(tabIconSvg(body)));
    console.log(`wrote tabs/${name}`);
  }
}
writeTabIcons();
