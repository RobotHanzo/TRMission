/**
 * Generates `src/art/trainCars.ts` — the nine rolling-stock illustrations, shared by apps/web and
 * apps/mobile — from the authored sheets in `assets/art/`.
 *
 *   node packages/client-core/tools/trainCarArt.mjs [--svg-dir <dir>]
 *
 * Two things make the generated module usable by BOTH clients:
 *
 *   · No CSS. The sheets style everything through `.cls-N` rules, which react-native-svg cannot
 *     apply, so every rule is resolved and inlined as presentation attributes.
 *   · No colours. Every ink is replaced by a `$n` placeholder into a per-car palette, so the
 *     night livery is a palette swap in plain TS rather than a media query — the same code path
 *     on DOM and on native.
 *
 * `--svg-dir` additionally writes standalone per-colour SVGs (used by docs/demos/train-cards,
 * which carries its own CSS-based dark mode because it renders outside the app's theme).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(PKG, 'assets', 'art');
const OUT = path.join(PKG, 'src', 'art', 'skins', 'rollingStock.ts');

/* ── the sheets ────────────────────────────────────────────────────────────── */

/** Line spans of each vehicle's <g> in the nine-up sheet, and where its ink actually falls.
 *  The crop boxes are a per-pixel measurement — getBBox is no use, it ignores clip paths and
 *  several cars have clipped overflow. Re-measure if the artwork is redrawn. */
const CARS = [
  {
    key: 'RED',
    name: '普悠瑪',
    model: 'TEMU2000型',
    a: 235,
    b: 315,
    ink: { x: 30, y: 100.67, w: 170.33, h: 73.33 },
  },
  {
    key: 'ORANGE',
    name: '太魯閣',
    model: 'TEMU1000型',
    a: 316,
    b: 389,
    ink: { x: 212.33, y: 170, w: 170.33, h: 73.33 },
  },
  {
    key: 'GREEN',
    name: 'EMU900型',
    model: '區間車',
    a: 390,
    b: 494,
    ink: { x: 30, y: 425.33, w: 170.67, h: 73.33 },
  },
  {
    key: 'BLUE',
    name: 'C371型',
    model: '臺北捷運',
    a: 561,
    b: 650,
    ink: { x: 212.33, y: 364.33, w: 170.33, h: 66 },
  },
  {
    key: 'PURPLE',
    name: '2000型',
    model: '桃園捷運',
    a: 651,
    b: 744,
    ink: { x: 394.33, y: 432.67, w: 170.67, h: 66 },
  },
  {
    key: 'WHITE',
    name: '35N21000型',
    model: '篷斗車',
    a: 745,
    b: 814,
    ink: { x: 394.33, y: 614.67, w: 170.67, h: 64.67 },
  },
  {
    key: 'BLACK',
    name: '30G1000型',
    model: '敞車',
    a: 815,
    b: 888,
    ink: { x: 30, y: 614.67, w: 170.67, h: 64.67 },
  },
  {
    key: 'LOCOMOTIVE',
    name: 'R20型',
    model: '柴電機車',
    a: 889,
    b: 1012,
    ink: { x: 212.33, y: 680, w: 170.33, h: 71.33 },
  },
];
// The yellow car comes from its own file; 阿里山號 (the sheet's yellow) is deliberately unused.
const YELLOW = {
  key: 'YELLOW',
  name: '610型',
  model: '新北捷運',
  file: '610.svg',
  a: 74,
  b: 176, // the page-background rect and the trailing text group are dropped
  ink: { x: 56, y: 61.67, w: 171.67, h: 72.67 },
};

/** One shared frame so all nine vehicles come out at the same scale. */
const BOX = { w: 176, h: 79 };

/* ── night livery ──────────────────────────────────────────────────────────── */

/**
 * The ramp is DIMMED, not repainted. The sheets are drawn on a near-black page, so their
 * bodywork is near-white — around 12:1 against a dark card face, the brightest thing in a dark
 * UI. Every authored neutral is mixed toward one ground by a single constant, which keeps each
 * ink's own hue and the spacing between them: hand-picked dark values carry a hue the artwork
 * never had, and that reads as a car repainted rather than a car in low light.
 *
 * Liveries and R20's rainbow are untouched — they are the card's identity, and they read better
 * once the body around them is no longer white. Windows and door bands were already the darkest
 * inks; they stay darkest and still clear ~2:1 against the toned-down body.
 */
const NIGHT_GROUND = '#1a1d20'; // the app's dark paper — a hair cooler than black, never blue
const DIM = 0.415; // enough to kill the glare, not so much that a pale car stops reading as pale
const BODY_NEUTRALS = [
  '#ffffff',
  '#efeeef',
  '#dbdcdc',
  '#c8c9ca', // bodywork, roofs, skirts
  '#b5b4b5',
  '#b4b4b5',
  '#9e9e9f',
  '#888888', // frames, bogies, wheel strokes
  '#717071',
  '#717072',
];

/** Per-car departures from the ramp. */
const PER_CAR = {
  // The open wagon is the one car dimming cannot help: its body already IS the dark navy family,
  // and on the black card's face (~#24272a) it would only become a hole. Lift that family into a
  // lit steel range instead. Its frame stays on the shared ramp, which still lands well above the
  // lifted body — an open wagon is read entirely by its frame.
  BLACK: {
    '#12222f': '#465c70', // outer frame / skirt
    '#142536': '#4d647a', // sill + rib strokes
    '#242e3a': '#54697d', // interior back wall
    '#334454': '#647d94', // interior panels
    '#64717a': '#93a3ae', // interior highlight
  },
};

/* ── colour helpers ────────────────────────────────────────────────────────── */
const expand = (hex) => {
  const h = hex.replace('#', '').toLowerCase();
  return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h);
};
const parseHex = (hex) => {
  const n = parseInt(expand(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) =>
  '#' +
  rgb
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const mix = (a, b, t) => {
  const [A, B] = [parseHex(a), parseHex(b)];
  return toHex(A.map((c, i) => c + (B[i] - c) * t));
};

const nightMap = (key) => {
  const ramp = Object.fromEntries(BODY_NEUTRALS.map((h) => [h, mix(h, NIGHT_GROUND, DIM)]));
  const merged = { ...ramp, ...(PER_CAR[key] ?? {}) };
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [expand(k), v]));
};

/* ── SVG parsing ───────────────────────────────────────────────────────────── */
const readSheet = (file) => {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  return {
    lines: src.split(/\r?\n/),
    style: src.match(/<style>([\s\S]*?)<\/style>/)[1],
    defs: src.match(/<defs>([\s\S]*?)<\/defs>/)[1],
  };
};

/** `.cls-N` → its accumulated declarations, in document order (last wins per property). */
function classDeclarations(style) {
  const out = new Map();
  for (const m of style.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sels = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('.'));
    const decls = m[2]
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(':');
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
      });
    for (const sel of sels) {
      const cls = sel.slice(1);
      if (!out.has(cls)) out.set(cls, new Map());
      for (const [prop, val] of decls) out.get(cls).set(prop, val);
    }
  }
  return out;
}

/** clipPath / gradient blocks in <defs>, keyed by id. */
function defBlocks(defs) {
  const out = {};
  for (const m of defs.matchAll(
    /<(clipPath|linearGradient|radialGradient)\b[^>]*id="([^"]+)"[\s\S]*?<\/\1>/g,
  ))
    out[m[2]] = m[0];
  return out;
}

/** Inline every `class="cls-N"` as presentation attributes, dropping any attribute it overrides. */
function inlineClasses(markup, decls) {
  return markup.replace(/<(\w+)([^>]*?)(\/?)>/g, (whole, tag, attrs, close) => {
    const cls = attrs.match(/\s?class="([^"]+)"/);
    if (!cls) return whole;
    const props = new Map();
    for (const name of cls[1].split(/\s+/))
      for (const [p, v] of decls.get(name) ?? []) props.set(p, v);
    let rest = attrs.replace(/\s?class="[^"]+"/, '');
    for (const p of props.keys()) rest = rest.replace(new RegExp(`\\s${p}="[^"]*"`, 'g'), '');
    const added = [...props].map(([p, v]) => ` ${p}="${v}"`).join('');
    return `<${tag}${rest}${added}${close}>`;
  });
}

/** Prefix every def id so nine illustrations can coexist in one document. */
function namespaceIds(markup, prefix, ids) {
  let s = markup;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const safe = prefix + id.replace(/[^A-Za-z0-9_-]/g, '');
    s = s.replace(new RegExp(`id="${esc}"`, 'g'), `id="${safe}"`);
    s = s.replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${safe})`);
  }
  return s;
}

/** Replace every colour literal with a `$n` index into a palette. */
function tokenise(markup) {
  const palette = [];
  const index = new Map();
  const body = markup.replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, (hex) => {
    const key = expand(hex);
    if (!index.has(key)) {
      index.set(key, palette.length);
      palette.push(key);
    }
    return `$${index.get(key)}`;
  });
  return { body, palette };
}

/** Everything an illustration needs: one tokenised body + a palette per theme. */
function buildCar(car, sheet, prefix) {
  const decls = classDeclarations(sheet.style);
  const raw = sheet.lines.slice(car.a - 1, car.b).join('\n');
  const inlined = inlineClasses(raw, decls);

  // pull in only the defs this car actually references, transitively
  const allDefs = defBlocks(sheet.defs);
  const ids = new Set();
  let pool = inlined;
  for (let grew = true; grew;) {
    grew = false;
    for (const m of pool.matchAll(/url\(#([^)]+)\)/g)) {
      if (allDefs[m[1]] && !ids.has(m[1])) {
        ids.add(m[1]);
        pool += allDefs[m[1]];
        grew = true;
      }
    }
  }
  const defsMarkup = [...ids].map((id) => inlineClasses(allDefs[id], decls)).join('');

  let merged = namespaceIds((defsMarkup ? `<defs>${defsMarkup}</defs>` : '') + inlined, prefix, [
    ...ids,
  ])
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*\n\s*/g, '')
    .trim();

  // Drop Illustrator's layer bookkeeping. `id="_普悠瑪"` is decorative, but ids must be unique in
  // the document that renders them — and a hand holding two of a colour mounts the same body
  // twice. Anything actually referenced by a url(#…) was namespaced above and is kept.
  const referenced = new Set([...merged.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]));
  merged = merged
    .replace(/\sdata-name="[^"]*"/g, '')
    .replace(/\sid="([^"]+)"/g, (whole, id) => (referenced.has(id) ? whole : ''));

  const { body, palette } = tokenise(merged);
  const night = nightMap(car.key);
  const { x, y, w, h } = car.ink;
  return {
    key: car.key,
    name: car.name,
    model: car.model,
    viewBox: [
      +(x + w / 2 - BOX.w / 2).toFixed(2),
      +(y + h / 2 - BOX.h / 2).toFixed(2),
      BOX.w,
      BOX.h,
    ].join(' '),
    body,
    palette,
    paletteDark: palette.map((hex) => night[hex] ?? hex),
  };
}

/* ── emit ──────────────────────────────────────────────────────────────────── */
const sheet = readSheet('鐵島企劃-車廂.svg');
const y610 = readSheet(YELLOW.file);
const PREFIX = {
  RED: 'r',
  ORANGE: 'o',
  YELLOW: 'y',
  GREEN: 'g',
  BLUE: 'b',
  PURPLE: 'p',
  BLACK: 'k',
  WHITE: 'w',
  LOCOMOTIVE: 'l',
};

const built = [
  ...CARS.map((c) => buildCar(c, sheet, `trm-${PREFIX[c.key]}-`)),
  buildCar(YELLOW, y610, `trm-${PREFIX.YELLOW}-`),
];
// canonical CARD_COLORS order
const ORDER = [
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'BLUE',
  'PURPLE',
  'BLACK',
  'WHITE',
  'LOCOMOTIVE',
];
built.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

const q = (s) => JSON.stringify(s);
const ts = `// GENERATED by tools/trainCarArt.mjs from assets/art/ — do not edit by hand.
//
// The \`rollingStock\` skin pack: the nine authored side elevations, shared by apps/web (DOM SVG)
// and apps/mobile (react-native-svg). Each entry is one SVG body with every ink replaced by a
// \`$n\` placeholder into \`palette\`, so the night livery is a palette swap rather than a
// stylesheet — the same code path on both platforms. The pack registry and the resolver that
// consumes this live in ../trainCars.ts; render through \`trainCarArt(color, dark, skin)\`, never
// off these raw bodies.
//
// 610型 is the yellow car; 阿里山號 (the sheet's own yellow) is deliberately unused.
import type { TrainCarArtSet } from '../types';

export const ROLLING_STOCK_ART: TrainCarArtSet = {
${built
  .map(
    (c) => `  ${c.key}: {
    name: ${q(c.name)},
    model: ${q(c.model)},
    viewBox: ${q(c.viewBox)},
    palette: ${JSON.stringify(c.palette)},
    paletteDark: ${JSON.stringify(c.paletteDark)},
    body: ${q(c.body)},
  },`,
  )
  .join('\n')}
};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, ts);
console.log(`wrote ${path.relative(PKG, OUT)}  ${(ts.length / 1024).toFixed(0)}KB`);

/* Optional: standalone SVGs for docs/demos/train-cards, which renders outside the app's theme
 * and so keeps a CSS-based dark mode of its own. */
const svgDirFlag = process.argv.indexOf('--svg-dir');
if (svgDirFlag !== -1) {
  const dir = process.argv[svgDirFlag + 1];
  fs.mkdirSync(dir, { recursive: true });
  for (const c of built) {
    // One class per (property, ink) pair that the night livery actually changes — a single class
    // carrying fill+stroke+stop-color would repaint `fill="none"` strokes, and CSS beats
    // presentation attributes, so the shape would fill in. Classes are collected per ELEMENT so
    // a tag using the same ink for fill and stroke still gets one class attribute.
    const used = new Set();
    const cls = (prop, i) => `trm-${PREFIX[c.key]}${prop[0]}${i}`;
    const changes = (prop, i) => c.palette[i] !== c.paletteDark[i];

    const tinted = c.body.replace(/<(\w+)([^>]*?)(\/?)>/g, (whole, tag, attrs, close) => {
      const mine = [];
      const painted = attrs.replace(/(fill|stroke|stop-color)="\$(\d+)"/g, (_, prop, n) => {
        const i = Number(n);
        if (changes(prop, i)) {
          mine.push(cls(prop, i));
          used.add(`${prop}|${i}`);
        }
        return `${prop}="${c.palette[i]}"`;
      });
      if (!mine.length) return `<${tag}${painted}${close}>`;
      return `<${tag}${painted} class="${mine.join(' ')}"${close}>`;
    });

    const rules = (sel, dark) =>
      [...used]
        .map((k) => {
          const [prop, n] = k.split('|');
          const i = Number(n);
          return `${sel}.${cls(prop, i)}{${prop}:${dark ? c.paletteDark[i] : c.palette[i]}}`;
        })
        .join('');
    const style = used.size
      ? `<style>@media (prefers-color-scheme: dark){${rules('', true)}}` +
        rules(":root[data-theme='dark'] ", true) +
        rules(":root[data-theme='light'] ", false) +
        `</style>`
      : '';
    fs.writeFileSync(
      path.join(dir, `${c.key}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${c.viewBox}" class="rs-art" aria-hidden="true" focusable="false">${style}${tinted}</svg>\n`,
    );
  }
  console.log(`wrote ${built.length} SVGs to ${dir}`);
}
