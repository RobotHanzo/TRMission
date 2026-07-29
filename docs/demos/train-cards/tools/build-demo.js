/* Emits the self-contained rolling-stock card demo. */
const fs = require('fs');
const path = require('path');

const ART = path.join(__dirname, 'cars');
const OUT = process.argv[2];
fs.mkdirSync(path.join(OUT, 'art'), { recursive: true });

const CARS = [
  { key: 'RED', hex: '#D72631', ink: '#FFFFFF', zh: '紅', glyph: '▲', name: '普悠瑪', model: 'TEMU2000型', role: '城際自強號' },
  { key: 'ORANGE', hex: '#EE7B30', ink: '#241300', zh: '橙', glyph: '◆', name: '太魯閣', model: 'TEMU1000型', role: '城際自強號' },
  { key: 'YELLOW', hex: '#F2C14E', ink: '#241B00', zh: '黃', glyph: '●', name: '610型', model: '610型', role: '新北捷運', note: '替換 阿里山號' },
  { key: 'GREEN', hex: '#3A9D5C', ink: '#FFFFFF', zh: '綠', glyph: '■', name: 'EMU900型', model: 'EMU900型', role: '區間車' },
  { key: 'BLUE', hex: '#0F5FA6', ink: '#FFFFFF', zh: '藍', glyph: '♠', name: 'C371型', model: 'C371型', role: '臺北捷運' },
  { key: 'PURPLE', hex: '#7B4DA6', ink: '#FFFFFF', zh: '紫', glyph: '✦', name: '2000型', model: '2000型', role: '桃園捷運' },
  { key: 'BLACK', hex: '#2B2D31', ink: '#FFFFFF', zh: '黑', glyph: '⬢', name: '30G1000型', model: '30G1000型', role: '敞車' },
  { key: 'WHITE', hex: '#E8EAED', ink: '#1B1C1E', zh: '白', glyph: '○', name: '35N21000型', model: '35N21000型', role: '篷斗車' },
  { key: 'LOCOMOTIVE', hex: '#9AA0A6', ink: '#13161A', zh: '彩虹車頭', glyph: '★', name: 'R20型', model: 'R20型', role: '柴電機車', wild: true },
];

for (const c of CARS) {
  fs.copyFileSync(path.join(ART, `${c.key}.svg`), path.join(OUT, 'art', `${c.key}.svg`));
  c.svg = fs.readFileSync(path.join(ART, `${c.key}.svg`), 'utf8').replace(/\n\s*/g, '\n');
}

const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>車廂卡插畫替換 — TRMission</title>
<style>
:root {
  --tr-blue: #0f5fa6;
  --tr-ember: #ee6b1f;
  --tr-paper: #f6f1e7;
  --tr-surface: #fffdf8;
  --tr-surface-2: #efe8da;
  --tr-ink: #1f2328;
  --tr-ink-soft: #5b6168;
  --tr-line: #d9d0be;
  --tr-coast: #b9a47b;
  --tr-shadow: 0 1px 2px rgba(31,35,40,.08), 0 4px 16px rgba(31,35,40,.08);
  --tr-font-cjk: 'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif;
  --tr-font-mono: 'IBM Plex Mono',ui-monospace,'Cascadia Code','Noto Sans TC','PingFang TC',monospace;
  --stage: #e7dfd0;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']):not([data-theme='dark']) { color-scheme: dark;
    --tr-paper:#1a1c1f; --tr-surface:#232629; --tr-surface-2:#2c2f33; --tr-ink:#ececec;
    --tr-ink-soft:#a8adb3; --tr-line:#3a3e43; --tr-coast:#515a44; --stage:#141619;
    --tr-shadow: 0 1px 2px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.35); }
}
:root[data-theme='dark'] { color-scheme: dark;
  --tr-paper:#1a1c1f; --tr-surface:#232629; --tr-surface-2:#2c2f33; --tr-ink:#ececec;
  --tr-ink-soft:#a8adb3; --tr-line:#3a3e43; --tr-coast:#515a44; --stage:#141619;
  --tr-shadow: 0 1px 2px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.35); }
:root[data-theme='light'] { color-scheme: light;
  --tr-paper:#f6f1e7; --tr-surface:#fffdf8; --tr-surface-2:#efe8da; --tr-ink:#1f2328;
  --tr-ink-soft:#5b6168; --tr-line:#d9d0be; --tr-coast:#b9a47b; --stage:#e7dfd0;
  --tr-shadow: 0 1px 2px rgba(31,35,40,.08), 0 4px 16px rgba(31,35,40,.08); }

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--tr-paper); color: var(--tr-ink);
  font-family: var(--tr-font-cjk); font-size: 15px; line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1120px; margin: 0 auto; padding: 40px 24px 72px; }

/* ── masthead ─────────────────────────────────────────────────────────────── */
.masthead { border-bottom: 2px solid var(--tr-ink); padding-bottom: 18px; }
.eyebrow {
  font-family: var(--tr-font-mono); font-size: 11px; letter-spacing: .18em;
  text-transform: uppercase; color: var(--tr-ink-soft); margin: 0 0 6px;
}
h1 { font-size: 30px; line-height: 1.25; margin: 0; text-wrap: balance; letter-spacing: -.01em; }
h1 .en { display: block; font-family: var(--tr-font-mono); font-size: 13px; font-weight: 500;
  letter-spacing: .04em; color: var(--tr-ink-soft); margin-top: 6px; }
.deck { max-width: 62ch; margin: 14px 0 0; color: var(--tr-ink-soft); }
.deck b { color: var(--tr-ink); font-weight: 600; }

/* ── controls ─────────────────────────────────────────────────────────────── */
.controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 20px 0 0; }
.seg { display: inline-flex; border: 1px solid var(--tr-line); border-radius: 8px;
  background: var(--tr-surface); overflow: hidden; }
.seg button {
  appearance: none; border: 0; background: transparent; color: var(--tr-ink-soft);
  font: inherit; font-size: 13px; padding: 7px 14px; cursor: pointer;
  border-right: 1px solid var(--tr-line);
}
.seg button:last-child { border-right: 0; }
.seg button[aria-pressed='true'] { background: var(--tr-blue); color: #fff; font-weight: 600; }
.seg button:focus-visible { outline: 2px solid var(--tr-ember); outline-offset: -2px; }
.toggle { display: inline-flex; align-items: center; gap: 7px; font-size: 13px;
  color: var(--tr-ink-soft); border: 1px solid var(--tr-line); border-radius: 8px;
  background: var(--tr-surface); padding: 6px 12px; cursor: pointer; }
.toggle input { accent-color: var(--tr-blue); margin: 0; }

/* ── section headers ──────────────────────────────────────────────────────── */
section { margin-top: 44px; }
.sec-head { display: flex; align-items: baseline; gap: 12px; border-bottom: 1px solid var(--tr-line);
  padding-bottom: 8px; margin-bottom: 20px; }
.sec-head h2 { font-size: 17px; margin: 0; letter-spacing: .01em; }
.sec-head .hint { font-family: var(--tr-font-mono); font-size: 11px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--tr-ink-soft); margin-left: auto; }

/* ── roster ───────────────────────────────────────────────────────────────── */
.roster { display: grid; gap: 1px; background: var(--tr-line);
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); border: 1px solid var(--tr-line); }
.slot { background: var(--tr-surface); display: flex; gap: 16px; padding: 16px; align-items: center; }
.spec { min-width: 0; }
.spec .key { font-family: var(--tr-font-mono); font-size: 11px; letter-spacing: .14em;
  color: var(--tr-ink-soft); display: flex; align-items: center; gap: 6px; }
.spec .key i { width: 9px; height: 9px; border-radius: 2px; display: inline-block;
  border: 1px solid rgba(0,0,0,.25); }
.spec .name { font-size: 17px; font-weight: 700; margin-top: 3px; letter-spacing: .01em; }
.spec .role { font-size: 13px; color: var(--tr-ink-soft); }
.spec .hexline { font-family: var(--tr-font-mono); font-size: 11px; line-height: 1.5;
  color: var(--tr-ink-soft); margin-top: 7px; font-variant-numeric: tabular-nums; }
.spec .hexline span { display: block; }
.spec .note { display: inline-block; margin-top: 7px; font-size: 11px; font-weight: 600;
  color: var(--tr-ember); border: 1px dashed currentColor; border-radius: 5px; padding: 1px 7px; }

/* ── in-context strips ────────────────────────────────────────────────────── */
.stage { background: var(--stage); border: 1px solid var(--tr-line); border-radius: 12px;
  padding: 20px; overflow-x: auto; }
.stage + .stage { margin-top: 16px; }
.stage-label { font-family: var(--tr-font-mono); font-size: 11px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--tr-ink-soft); margin: 0 0 12px; }
.strip { display: flex; gap: 12px; min-width: max-content; }

/* ── the card (mirrors apps/web/src/styles/game.css) ──────────────────────── */
.train-card {
  position: relative; width: 132px; aspect-ratio: 132 / 92; border-radius: 10px;
  border: 1px solid var(--tr-coast); overflow: hidden; flex: none;
  box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.35), var(--tr-shadow);
  transition: transform .12s ease;
}
.strip .train-card:hover { transform: translateY(-4px); }
.train-card.is-stacked {
  box-shadow: 3px 4px 0 -1px var(--tr-surface), 3px 4px 0 0 var(--tr-coast),
    inset 0 0 0 1.5px rgba(255,255,255,.35), var(--tr-shadow);
  margin-right: 4px; margin-bottom: 5px;
}
.train-card.is-stacked.is-stacked-deep {
  box-shadow: 3px 4px 0 -1px var(--tr-surface), 3px 4px 0 0 var(--tr-coast),
    6px 8px 0 -1px var(--tr-surface), 6px 8px 0 0 var(--tr-coast),
    inset 0 0 0 1.5px rgba(255,255,255,.35), var(--tr-shadow);
  margin-right: 6px; margin-bottom: 8px;
}
.train-card-edge { position: absolute; inset: 0 0 auto 0; height: 5px; opacity: .9; }
.is-loco { border-color: color-mix(in srgb, var(--tr-blue) 28%, var(--tr-coast)); }
.is-loco .train-card-edge { height: 7px; opacity: 1;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.55), 0 1px 2px rgba(0,0,0,.25); }
.train-card-gloss { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen;
  background: linear-gradient(118deg, rgba(255,255,255,.34) 0%, rgba(255,255,255,.07) 20%,
    transparent 42%, transparent 64%, rgba(255,255,255,.16) 100%); }
.rs-art { display: block; width: 100%; height: 100%; padding: 9px 6px 4px; }
/* The side-elevation artwork is far wider than the drawn carriage, so it gets its own
   slot: full-bleed across the face and pinned above the chip row. */
.is-art .rs-art { padding: 13px 0 21px; }
.train-card-glyph { position: absolute; left: 6px; bottom: 6px; width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center; border-radius: 6px;
  font-size: .78rem; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.train-card-count { position: absolute; right: 6px; bottom: 6px; min-width: 26px; height: 22px;
  padding: 0 6px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 7px; background: var(--tr-ink); color: var(--tr-paper); font-size: .82rem;
  font-weight: 800; font-variant-numeric: tabular-nums; }
.no-glyph .train-card-glyph { display: none; }

/* ── footnotes ────────────────────────────────────────────────────────────── */
.notes { margin-top: 44px; border-top: 1px solid var(--tr-line); padding-top: 16px;
  font-size: 13px; color: var(--tr-ink-soft); }
.notes dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
.notes dt { font-family: var(--tr-font-mono); font-size: 11px; letter-spacing: .1em;
  text-transform: uppercase; padding-top: 3px; }
.notes dd { margin: 0; }
.notes code { font-family: var(--tr-font-mono); font-size: 12px; background: var(--tr-surface-2);
  border-radius: 4px; padding: 1px 5px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
@media (max-width: 560px) {
  .wrap { padding: 28px 16px 56px; }
  h1 { font-size: 24px; }
  .notes dl { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="wrap">

  <header class="masthead">
    <p class="eyebrow">TRMission · 車廂插畫替換提案</p>
    <h1>車廂卡改用實車插畫<span class="en">Train cards, re-skinned with the rolling-stock artwork</span></h1>
    <p class="deck">
      九種車廂卡（八色 + 彩虹車頭）各自對應一款車輛插畫，取自 <b>台鐵任務-車廂.svg</b>。
      黃色卡改用 <b>610型</b>（<b>610.svg</b>），<b>不使用阿里山號</b>。
      卡面框線、色帶、色盲符號與張數標籤沿用 <code>apps/web</code> 現行樣式，只替換車輛圖。
    </p>
    <div class="controls">
      <div class="seg" role="group" aria-label="插畫版本">
        <button type="button" data-art="new" aria-pressed="true">新插畫</button>
        <button type="button" data-art="old" aria-pressed="false">目前向量圖</button>
      </div>
      <label class="toggle"><input type="checkbox" id="glyph" checked> 色盲符號</label>
      <label class="toggle"><input type="checkbox" id="dark"> 深色主題</label>
    </div>
  </header>

  <section>
    <div class="sec-head">
      <h2>車種對照</h2>
      <span class="hint">9 cards · 1 illustration each</span>
    </div>
    <div class="roster" id="roster"></div>
  </section>

  <section>
    <div class="sec-head">
      <h2>實際使用情境</h2>
      <span class="hint">actual size · 132px</span>
    </div>
    <div class="stage">
      <p class="stage-label">檯面 — 五張明牌</p>
      <div class="strip" id="market"></div>
    </div>
    <div class="stage">
      <p class="stage-label">手牌 — 含張數與疊牌陰影</p>
      <div class="strip" id="hand"></div>
    </div>
  </section>

  <div class="notes">
    <dl>
      <dt>黃色</dt>
      <dd>610型（新北捷運）取代原稿的阿里山號。阿里山號插畫已從這份提案中移除。</dd>
      <dt>裁切</dt>
      <dd>每款插畫都從原稿以實際著色範圍量測裁切，並統一為 <code>176 × 79</code> 的 viewBox，因此九張卡的車輛比例一致。</dd>
      <dt>命名</dt>
      <dd>檔案以引擎的 <code>CardColor</code> 命名（<code>art/RED.svg</code> … <code>art/LOCOMOTIVE.svg</code>），class 與 clipPath id 都已加前綴，可安全地並存於同一份文件。</dd>
      <dt>比例</dt>
      <dd>插畫是側視全車，比原本手繪的車廂寬得多；卡面因此把圖釘在上方、左右滿版，下緣留給符號與張數標籤。</dd>
      <dt>待確認</dt>
      <dd>黑色的 30G1000型敞車在深色主題下對比偏低（深色車身壓在深色卡面上）。切到深色主題可以看到，若要採用可能需要替卡面加一層淺色底。</dd>
    </dl>
  </div>
</div>

<script>
const CARS = ${JSON.stringify(CARS.map(({ svg, ...rest }) => rest))};
const ART = ${JSON.stringify(Object.fromEntries(CARS.map((c) => [c.key, c.svg])))};
const LIVERY = ['#D72631','#EE7B30','#F2C14E','#3A9D5C','#0F5FA6','#7B4DA6'];
const TRAIN_HEX = ['#D72631','#EE7B30','#F2C14E','#3A9D5C','#0F5FA6','#7B4DA6','#2B2D31','#E8EAED'];

/* ── colour maths, ported from apps/web/src/theme/shade.ts ─────────────────── */
const parse = (hex) => { let h = hex.replace('#','').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16); return [(n>>16)&255, (n>>8)&255, n&255]; };
const clamp = (n) => n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
const toHex = (rgb) => '#' + rgb.map(v => clamp(v).toString(16).padStart(2,'0')).join('');
const mix = (a,b,t) => { const A = parse(a), B = parse(b);
  return toHex([0,1,2].map(i => A[i] + (B[i]-A[i])*t)); };
const shade = (h,t) => mix(h,'#16120c',t);
const tint = (h,t) => mix(h,'#ffffff',t);
const rgba = (h,a) => { const [r,g,b] = parse(h); return \`rgba(\${r}, \${g}, \${b}, \${a})\`; };
const lum = (h) => { const [r,g,b] = parse(h).map(v => v/255); return .2126*r + .7152*g + .0722*b; };

/* ── the current procedural artwork, ported from TrainCarArt.tsx ───────────── */
let uidN = 0;
function carriageSvg(hex) {
  const uid = 'u' + (uidN++);
  const bodyTop = tint(hex,.26), bodyBot = shade(hex,.22), roof = shade(hex,.5),
        roofTop = shade(hex,.36), belt = shade(hex,.4),
        glass = lum(hex) > .6 ? shade(hex,.16) : tint(hex,.66),
        glassEdge = shade(hex,.3), metal = '#2c2722', hub = tint(hex,.34);
  const windows = [18,36.5,55,73.5,92];
  return \`<svg viewBox="0 0 132 72" class="rs-art" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="body-\${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="\${bodyTop}"/><stop offset="0.55" stop-color="\${hex}"/>
        <stop offset="1" stop-color="\${bodyBot}"/></linearGradient>
      <linearGradient id="glass-\${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="\${tint(glass,.34)}"/><stop offset="1" stop-color="\${glass}"/>
      </linearGradient>
    </defs>
    <ellipse cx="66" cy="64.5" rx="52" ry="3.4" fill="rgba(0,0,0,0.16)"/>
    <g fill="\${metal}"><rect x="24" y="50" width="22" height="5" rx="1.4"/>
      <rect x="86" y="50" width="22" height="5" rx="1.4"/></g>
    \${[30,40,92,102].map(cx => \`<g><circle cx="\${cx}" cy="55" r="4.6" fill="\${metal}"/>
      <circle cx="\${cx}" cy="55" r="1.7" fill="\${hub}"/></g>\`).join('')}
    <circle cx="9.5" cy="44" r="1.7" fill="\${belt}"/><circle cx="122.5" cy="44" r="1.7" fill="\${belt}"/>
    <rect x="36" y="6" width="60" height="8" rx="3.4" fill="\${roofTop}"/>
    <rect x="14" y="11.5" width="104" height="9" rx="4.5" fill="\${roof}"/>
    <rect x="13" y="19" width="106" height="30" rx="4.2" fill="url(#body-\${uid})"/>
    <rect x="15" y="48" width="102" height="3.4" rx="1" fill="\${belt}"/>
    \${windows.map(x => \`<rect x="\${x}" y="24" width="13.5" height="12" rx="2"
      fill="url(#glass-\${uid})" stroke="\${glassEdge}" stroke-width="0.7"/>\`).join('')}
    <line x1="15" y1="39.5" x2="117" y2="39.5" stroke="\${belt}" stroke-width="1.1"/>
    <rect x="16" y="41" width="100" height="5" rx="1.5" fill="\${tint(hex,.18)}" opacity="0.5"/>
  </svg>\`;
}
function locomotiveSvg() {
  const uid = 'u' + (uidN++);
  const steel = '#9AA0A6', dark = shade(steel,.62), mid = shade(steel,.3),
        light = tint(steel,.4), hub = tint(steel,.55);
  const wheels = [{cx:52,r:8.4},{cx:74,r:8.4},{cx:97,r:5}];
  return \`<svg viewBox="0 0 132 72" class="rs-art" aria-hidden="true" focusable="false">
    <defs><linearGradient id="boiler-\${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="\${light}"/><stop offset="0.5" stop-color="\${steel}"/>
      <stop offset="1" stop-color="\${mid}"/></linearGradient></defs>
    <ellipse cx="66" cy="64.5" rx="54" ry="3.4" fill="rgba(0,0,0,0.18)"/>
    <rect x="12" y="13" width="30" height="30" rx="3" fill="url(#boiler-\${uid})"/>
    <rect x="12" y="11" width="30" height="5" rx="2" fill="\${dark}"/>
    <rect x="17" y="18" width="14" height="11" rx="2" fill="\${tint(steel,.62)}" stroke="\${dark}" stroke-width="0.8"/>
    <rect x="38" y="24" width="64" height="19" rx="9.5" fill="url(#boiler-\${uid})"/>
    <rect x="42" y="25.4" width="56" height="2.6" rx="1.3" fill="rgba(255,255,255,0.42)"/>
    <rect x="15" y="15" width="24" height="1.9" rx="1" fill="rgba(255,255,255,0.32)"/>
    <ellipse cx="99" cy="30" rx="2.4" ry="4.4" fill="rgba(255,255,255,0.28)"/>
    \${[52,66,80].map(x => \`<line x1="\${x}" y1="25" x2="\${x}" y2="42" stroke="\${mid}" stroke-width="1" opacity="0.7"/>\`).join('')}
    <circle cx="101" cy="33.5" r="9.6" fill="\${mid}"/>
    <circle cx="101" cy="33.5" r="9.6" fill="none" stroke="\${dark}" stroke-width="1"/>
    <circle cx="106" cy="28" r="2.2" fill="\${tint(steel,.7)}" stroke="\${dark}" stroke-width="0.5"/>
    <path d="M86 24 L98 24 L95.5 11 L88.5 11 Z" fill="\${dark}"/>
    <rect x="86" y="9" width="13" height="3.5" rx="1.5" fill="\${mid}"/>
    <path d="M60 24 a7 7 0 0 1 14 0 Z" fill="\${dark}"/>
    <path d="M46 24 a5 5 0 0 1 10 0 Z" fill="\${mid}"/>
    <rect x="30" y="43" width="78" height="3.6" rx="1" fill="\${dark}"/>
    <path d="M108 43 L118 56 L102 56 Z" fill="\${mid}" stroke="\${dark}" stroke-width="0.6"/>
    \${wheels.map(({cx,r}) => \`<g><circle cx="\${cx}" cy="54" r="\${r}" fill="\${dark}"/>
      <circle cx="\${cx}" cy="54" r="\${r*.42}" fill="\${hub}"/>
      \${[0,60,120].map(a => { const rad = a*Math.PI/180;
        return \`<line x1="\${cx}" y1="54" x2="\${cx+Math.cos(rad)*r*.78}" y2="\${54+Math.sin(rad)*r*.78}" stroke="\${mid}" stroke-width="1"/>\`;
      }).join('')}</g>\`).join('')}
    <line x1="52" y1="54" x2="74" y2="54" stroke="\${mid}" stroke-width="2.2" stroke-linecap="round"/>
    <g stroke="rgba(0,0,0,0.28)" stroke-width="0.3">
      \${LIVERY.map((c,i) => \`<rect x="\${13+i*5.6}" y="46.4" width="5" height="4.2" rx="0.8" fill="\${c}"/>\`).join('')}
      <rect x="13" y="46.6" width="33.6" height="1.1" rx="0.5" fill="rgba(255,255,255,0.45)" stroke="none"/>
    </g>
  </svg>\`;
}

/* ── card ─────────────────────────────────────────────────────────────────── */
const WILD_EDGE = \`linear-gradient(90deg, \${TRAIN_HEX.join(', ')})\`;
const WILD_WASH = \`linear-gradient(150deg, \${LIVERY.map(h => rgba(h,.2)).join(', ')})\`;

function card(c, { count, mode }) {
  const el = document.createElement('div');
  const stacked = count > 1, deep = count > 2;
  el.className = 'train-card' + (c.wild ? ' is-loco' : '') + (stacked ? ' is-stacked' : '') +
    (deep ? ' is-stacked-deep' : '') + (mode === 'new' ? ' is-art' : '');
  el.style.background = c.wild
    ? \`\${WILD_WASH}, var(--tr-surface)\`
    : \`linear-gradient(160deg, \${rgba(c.hex,.2)}, \${rgba(c.hex,.05)}), var(--tr-surface)\`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', c.zh + (count ? \` ×\${count}\` : ''));
  el.title = \`\${c.name} · \${c.role}\`;

  const edge = document.createElement('span');
  edge.className = 'train-card-edge';
  edge.style.background = c.wild ? WILD_EDGE : c.hex;
  el.append(edge);

  const art = document.createElement('div');
  art.style.cssText = 'display:contents';
  art.innerHTML = mode === 'new' ? ART[c.key] : (c.wild ? locomotiveSvg() : carriageSvg(c.hex));
  el.append(art);

  if (c.wild) { const g = document.createElement('span'); g.className = 'train-card-gloss'; el.append(g); }

  const glyph = document.createElement('span');
  glyph.className = 'train-card-glyph';
  glyph.style.background = c.hex; glyph.style.color = c.ink;
  glyph.textContent = c.glyph;
  el.append(glyph);

  if (count) {
    const n = document.createElement('span');
    n.className = 'train-card-count'; n.textContent = '×' + count;
    el.append(n);
  }
  return el;
}

/* ── render ───────────────────────────────────────────────────────────────── */
const HAND = { RED: 4, ORANGE: 1, GREEN: 2, BLUE: 3, LOCOMOTIVE: 2 };
const MARKET = ['YELLOW','BLACK','LOCOMOTIVE','WHITE','PURPLE'];
let mode = 'new';

function render() {
  const roster = document.getElementById('roster');
  roster.replaceChildren(...CARS.map(c => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.append(card(c, { mode }));
    const spec = document.createElement('div');
    spec.className = 'spec';
    spec.innerHTML =
      \`<div class="key"><i style="background:\${c.hex}"></i>\${c.key}　\${c.zh}</div>\` +
      \`<div class="name">\${c.name}</div>\` +
      \`<div class="role">\${c.role}</div>\` +
      \`<div class="hexline"><span>\${c.hex}</span><span>art/\${c.key}.svg</span></div>\` +
      (c.note ? \`<span class="note">\${c.note}</span>\` : '');
    slot.append(spec);
    return slot;
  }));

  document.getElementById('market').replaceChildren(
    ...MARKET.map(k => card(CARS.find(c => c.key === k), { mode })));
  document.getElementById('hand').replaceChildren(
    ...Object.entries(HAND).map(([k, n]) => card(CARS.find(c => c.key === k), { count: n, mode })));
}

document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.art;
  document.querySelectorAll('.seg button').forEach(o =>
    o.setAttribute('aria-pressed', String(o.dataset.art === mode)));
  render();
}));
document.getElementById('glyph').addEventListener('change', (e) =>
  document.body.classList.toggle('no-glyph', !e.target.checked));
/* The theme is whatever the page is already rendering in — an OS preference here, or the
   host's own toggle when this page is embedded. Reflect it, never force it at load. */
const darkBox = document.getElementById('dark');
const isDark = () => document.documentElement.dataset.theme
  ? document.documentElement.dataset.theme === 'dark'
  : matchMedia('(prefers-color-scheme: dark)').matches;
const syncBox = () => { darkBox.checked = isDark(); };
syncBox();
new MutationObserver(syncBox).observe(document.documentElement,
  { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncBox);
darkBox.addEventListener('change', (e) =>
  document.documentElement.dataset.theme = e.target.checked ? 'dark' : 'light');

render();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('wrote', path.join(OUT, 'index.html'), (html.length / 1024).toFixed(0) + 'KB');

/* A body-only variant for hosts that supply their own document skeleton. */
if (process.argv[3]) {
  const fragment = html
    .replace(/^[\s\S]*?<meta name="viewport"[^>]*>\s*/, '')
    .replace(/<\/head>\s*<body>\s*/, '')
    .replace(/\s*<\/body>\s*<\/html>\s*$/, '\n');
  fs.writeFileSync(process.argv[3], fragment);
  console.log('wrote', process.argv[3], (fragment.length / 1024).toFixed(0) + 'KB');
}
