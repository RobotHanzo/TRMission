// Dev tool: rasterises every OG social card (and a spread of data states for each) so a human
// can eyeball the actual resvg output instead of reading SVG markup. Not part of the build/test
// graph — run it directly:
//
//   yarn workspace @trm/server preview:og
//
// Output lands in apps/server/.og-preview/ (gitignored) and is left on disk between runs — open
// index.html in a browser, or the individual .png files, to review.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { TAIWAN_CONTENT } from '@trm/map-data';
import {
  CARD_W,
  siteCardSvg,
  roomCardSvg,
  replayCardSvg,
  mapCardSvg,
  OG_FONT_FILES,
  type RoomCardData,
  type ReplayCardData,
  type MapCardData,
} from '../src/og/card-svg';
import type { RenderableMap } from '../src/og/map-svg';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '.og-preview');

// Same font config as OgService.renderPng — the preview must show exactly what prod renders.
function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CARD_W },
    font: { loadSystemFonts: false, fontFiles: OG_FONT_FILES },
  });
  return resvg.render().asPng();
}

// A small synthetic custom map — exercises the bounding-box fallback view (no `geography`),
// a double-route pair, a tunnel, and a ferry crossing, distinct from the bundled Taiwan map.
const CUSTOM_MAP: RenderableMap = {
  cities: [
    { id: 'a', x: 10, y: 20 },
    { id: 'b', x: 40, y: 15 },
    { id: 'c', x: 70, y: 30 },
    { id: 'd', x: 55, y: 60 },
    { id: 'e', x: 20, y: 65 },
    { id: 'f', x: 85, y: 70, isIsland: true },
  ],
  routes: [
    { id: 'r1', a: 'a', b: 'b', color: 'TEAL', length: 3, ferryLocos: 0, isTunnel: false },
    { id: 'r2', a: 'b', b: 'c', color: 'MAGENTA', length: 4, ferryLocos: 0, isTunnel: true },
    { id: 'r3', a: 'c', b: 'd', color: 'GRAY', length: 2, ferryLocos: 1, isTunnel: false },
    { id: 'r4', a: 'd', b: 'e', color: 'GREEN', length: 3, ferryLocos: 0, isTunnel: false },
    {
      id: 'r5a',
      a: 'a',
      b: 'e',
      color: 'AMBER',
      length: 2,
      doubleGroup: 'X',
      ferryLocos: 0,
      isTunnel: false,
    },
    {
      id: 'r5b',
      a: 'a',
      b: 'e',
      color: 'SLATE',
      length: 2,
      doubleGroup: 'X',
      ferryLocos: 0,
      isTunnel: false,
    },
    { id: 'r6', a: 'd', b: 'f', color: 'TEAL', length: 3, ferryLocos: 1, isTunnel: false },
  ],
};

interface Card {
  file: string;
  label: string;
  svg: string;
}

const rooms: [string, string, RoomCardData][] = [
  [
    'room-lobby-mixed',
    'LOBBY · mixed ready states',
    {
      code: 'MK7Q28',
      maxSeats: 5,
      seatMembers: [
        { seat: 0, kind: 'human', ready: true },
        { seat: 1, kind: 'human', ready: false },
        { seat: 2, kind: 'bot', ready: true },
      ],
      mapName: { zh: '台灣本島', en: 'Main Island' },
      status: 'LOBBY',
    },
  ],
  [
    'room-empty',
    'LOBBY · 0/2, no map chosen yet',
    { code: 'AB12CD', maxSeats: 2, seatMembers: [], status: 'LOBBY' },
  ],
  [
    'room-full-started',
    'STARTED · 5/5, long custom map name',
    {
      code: 'ZZ9999',
      maxSeats: 5,
      seatMembers: [0, 1, 2, 3, 4].map((seat) => ({
        seat,
        kind: seat % 2 === 0 ? ('human' as const) : ('bot' as const),
        ready: seat !== 4,
      })),
      mapName: {
        zh: '極長的自訂地圖名稱測試看看會不會爆版',
        en: 'A Very Long Custom Map Name For Overflow Testing',
      },
      status: 'STARTED',
    },
  ],
  [
    'room-closed',
    'CLOSED · 1/3',
    {
      code: 'QW3RTY',
      maxSeats: 3,
      seatMembers: [{ seat: 0, kind: 'human', ready: true }],
      status: 'CLOSED',
    },
  ],
];

const replays: [string, string, ReplayCardData][] = [
  [
    'replay-standard',
    '5 players, winner highlighted',
    {
      mapName: { zh: '台灣本島', en: 'Main Island' },
      completedAt: '2026-07-01T14:30:00.000Z',
      players: [
        { name: '王小明', seat: 2, score: 92, winner: true },
        { name: '李佳穎', seat: 0, score: 78, winner: false },
        { name: 'David Chen', seat: 1, score: 65, winner: false },
        { name: 'Alexander-the-Great', seat: 3, score: 54, winner: false },
        { name: '林', seat: 4, score: 41, winner: false },
      ],
    },
  ],
  [
    'replay-solo-no-map',
    '1 player, no map name (fallback title)',
    {
      completedAt: '2026-01-15T09:05:00.000Z',
      players: [{ name: '獨行俠', seat: 0, score: 30, winner: true }],
    },
  ],
];

const maps: [string, string, MapCardData][] = [
  [
    'map-official',
    'bundled Taiwan map, official coastline',
    {
      nameZh: TAIWAN_CONTENT.meta.nameZh,
      nameEn: TAIWAN_CONTENT.meta.nameEn,
      code: TAIWAN_CONTENT.meta.mapId.toUpperCase(),
      map: TAIWAN_CONTENT,
      missionCount: TAIWAN_CONTENT.tickets.length,
      official: true,
    },
  ],
  [
    'map-custom',
    'small custom draft, bounding-box view',
    {
      nameZh: '幻想群島',
      nameEn: 'Fantasy Isles',
      code: '8Q3KZP1A',
      map: CUSTOM_MAP,
      missionCount: 12,
    },
  ],
];

const cards: Card[] = [
  { file: 'site', label: 'Site / fallback card', svg: siteCardSvg() },
  ...rooms.map(([file, label, data]) => ({ file, label, svg: roomCardSvg(data) })),
  ...replays.map(([file, label, data]) => ({ file, label, svg: replayCardSvg(data) })),
  ...maps.map(([file, label, data]) => ({ file, label, svg: mapCardSvg(data) })),
];

mkdirSync(OUT_DIR, { recursive: true });
for (const card of cards) {
  writeFileSync(join(OUT_DIR, `${card.file}.svg`), card.svg);
  writeFileSync(join(OUT_DIR, `${card.file}.png`), renderPng(card.svg));
}

const index = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>OG card preview</title>
<style>
body{background:#2a2a2a;color:#eee;font:14px/1.4 system-ui,sans-serif;padding:24px;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:24px;}
figure{margin:0;background:#1a1a1a;border-radius:8px;padding:12px;}
figcaption{margin-top:8px;color:#aaa;}
figcaption b{color:#fff;}
img{width:100%;border-radius:6px;display:block;}
</style></head><body>
<h1>OG card preview</h1>
<p>Regenerate with <code>yarn workspace @trm/server preview:og</code>.</p>
<div class="grid">
${cards
  .map(
    (c) =>
      `<figure><img src="${c.file}.png" alt="${c.file}"><figcaption><b>${c.file}</b> — ${c.label}</figcaption></figure>`,
  )
  .join('\n')}
</div>
</body></html>`;
writeFileSync(join(OUT_DIR, 'index.html'), index);

console.log(`Rendered ${cards.length} cards to ${OUT_DIR}`);
console.log(`Open ${join(OUT_DIR, 'index.html')} to review.`);
