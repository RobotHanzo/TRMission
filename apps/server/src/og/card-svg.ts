// Hand-authored 1200×630 SVG social cards (GitHub-style). All artwork is original
// geometric brand styling — route-ribbon motifs echoing the board, never copied art.
// Text is XML-escaped here; rasterisation happens in OgService via resvg.
/* eslint no-irregular-whitespace: ["error", { "skipStrings": true, "skipTemplates": true }] --
   the card copy deliberately uses U+3000 ideographic spaces for CJK typography */

export const CARD_W = 1200;
export const CARD_H = 630;

// Brand tokens mirrored from apps/web/src/styles/tokens.css (light theme — social
// cards render on platform-neutral backgrounds, so the light palette reads best).
const BLUE = '#0f5fa6';
const SURFACE = '#fffdf8';
const SURFACE_2 = '#efe8da';
const INK = '#1f2328';
const INK_SOFT = '#5b6168';
const LINE = '#d9d0be';
/** Seat colours (apps/web/src/theme/colors.ts SEAT_COLORS) for player chips/dots. */
const SEAT_COLORS = ['#0E8C8C', '#C0398B', '#E8A33D', '#5A6B7B', '#7CB342'] as const;

const FONT_STACK =
  "'Noto Sans TC','Noto Sans CJK TC','Microsoft JhengHei','PingFang TC','Noto Sans',sans-serif";

export function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Approximate rendered width in px: CJK ≈ 1em, everything else ≈ 0.55em. */
export function estimateWidth(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) w += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 1 : 0.55;
  return w * fontSize;
}

/** Truncate with an ellipsis so the estimated width fits maxPx. */
export function fitText(s: string, fontSize: number, maxPx: number): string {
  if (estimateWidth(s, fontSize) <= maxPx) return s;
  let out = '';
  for (const ch of s) {
    if (estimateWidth(out + ch, fontSize) > maxPx - fontSize) break;
    out += ch;
  }
  return `${out}…`;
}

/** Diagonal strings of rounded "train car" slots — the background motif. */
function routeRibbons(): string {
  const rows = [
    { y: 70, colors: [0, 1, 2, 3, 4, 0, 1, 2] },
    { y: 260, colors: [3, 4, 0, 1, 2, 3, 4, 0] },
    { y: 450, colors: [2, 3, 4, 0, 1, 2, 3, 4] },
  ];
  const cars = rows
    .map((row, r) =>
      row.colors
        .map((c, i) => {
          const x = -80 + i * 190 + r * 45;
          return `<rect x="${x}" y="${row.y}" width="150" height="34" rx="10" fill="${SEAT_COLORS[c]}"/>
<circle cx="${x + 170}" cy="${row.y + 17}" r="7" fill="${LINE}"/>`;
        })
        .join('\n'),
    )
    .join('\n');
  return `<g opacity="0.12" transform="rotate(-7 600 315)">${cars}</g>`;
}

/** Tiny original locomotive glyph for the brand lockup (x/y = top-left of a 72×44 box). */
function trainGlyph(x: number, y: number): string {
  return `<g transform="translate(${x} ${y})">
  <rect x="0" y="4" width="58" height="28" rx="9" fill="${BLUE}"/>
  <rect x="8" y="11" width="12" height="10" rx="2.5" fill="${SURFACE}"/>
  <rect x="26" y="11" width="12" height="10" rx="2.5" fill="${SURFACE}"/>
  <rect x="44" y="11" width="8" height="10" rx="2.5" fill="${SURFACE}"/>
  <circle cx="14" cy="36" r="6" fill="${INK}"/>
  <circle cx="42" cy="36" r="6" fill="${INK}"/>
  <rect x="58" y="14" width="10" height="18" rx="3" fill="${BLUE}"/>
</g>`;
}

function frame(inner: string): string {
  return `<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
<rect width="${CARD_W}" height="${CARD_H}" fill="${SURFACE}"/>
${routeRibbons()}
<rect width="${CARD_W}" height="12" fill="${BLUE}"/>
<rect y="${CARD_H - 12}" width="${CARD_W}" height="12" fill="${BLUE}"/>
<g font-family="${FONT_STACK}">
${trainGlyph(72, 60)}
<text x="156" y="94" font-size="36" font-weight="700" fill="${BLUE}">台鐵任務 TRMission</text>
${inner}
</g>
</svg>`;
}

function kicker(text: string): string {
  return `<text x="72" y="204" font-size="27" letter-spacing="2" fill="${INK_SOFT}">${escapeXml(text)}</text>`;
}

/** The generic brand card — the homepage unfurl and the nondisclosing fallback. */
export function siteCardSvg(): string {
  return frame(`
${kicker('台灣鐵道路線競逐桌遊 · A RAILWAY BOARD GAME SET IN TAIWAN')}
<text x="72" y="330" font-size="84" font-weight="700" fill="${INK}">台鐵任務</text>
<text x="72" y="408" font-size="46" font-weight="600" fill="${INK_SOFT}">TRMission</text>
<text x="72" y="500" font-size="30" fill="${INK}">鋪設路線・連接城市・完成任務</text>
<text x="72" y="546" font-size="26" fill="${INK_SOFT}">Claim routes, link cities, complete missions — with friends or bots.</text>
`);
}

export interface RoomCardData {
  code: string;
  hostName?: string;
  seatsTaken: number;
  maxPlayers: number;
  mapName?: { zh: string; en: string };
  status: 'LOBBY' | 'STARTED' | 'CLOSED';
}

export function roomCardSvg(d: RoomCardData): string {
  const statusText =
    d.status === 'LOBBY'
      ? '等待玩家加入 · WAITING FOR PLAYERS'
      : d.status === 'STARTED'
        ? '對局進行中 · GAME IN PROGRESS'
        : '此房間已結束 · ROOM CLOSED';
  const code = escapeXml(d.code.toUpperCase());
  const codeW = Math.max(estimateWidth(d.code, 96) * 1.32 + 96, 320);
  const host = d.hostName ? fitText(d.hostName, 30, 380) : undefined;
  const detailBits = [
    ...(host ? [`房主 ${host}`] : []),
    `${d.seatsTaken}/${d.maxPlayers} 位玩家`,
    ...(d.mapName ? [fitText(`${d.mapName.zh} ${d.mapName.en}`, 30, 460)] : []),
  ];
  const seatDots = Array.from({ length: d.maxPlayers }, (_, i) => {
    const cx = 92 + i * 64;
    return i < d.seatsTaken
      ? `<circle cx="${cx}" cy="500" r="20" fill="${SEAT_COLORS[i % SEAT_COLORS.length]}"/>`
      : `<circle cx="${cx}" cy="500" r="19" fill="${SURFACE_2}" stroke="${LINE}" stroke-width="3"/>`;
  }).join('\n');

  return frame(`
${kicker(`邀請你加入遊戲 · ${statusText}`)}
<rect x="72" y="240" width="${codeW}" height="140" rx="20" fill="${SURFACE_2}" stroke="${LINE}" stroke-width="2"/>
<text x="${72 + codeW / 2}" y="338" font-size="96" font-weight="700" letter-spacing="14" text-anchor="middle" fill="${BLUE}">${code}</text>
<text x="72" y="440" font-size="30" fill="${INK}">${escapeXml(detailBits.join('　·　'))}</text>
${seatDots}
`);
}

export interface ReplayCardPlayer {
  name: string;
  seat: number;
  score: number;
  winner: boolean;
}

export interface ReplayCardData {
  mapName?: { zh: string; en: string };
  completedAt: string; // ISO
  players: ReplayCardPlayer[]; // already sorted, ≤5
}

export function replayCardSvg(d: ReplayCardData): string {
  const date = d.completedAt.slice(0, 10);
  const title = d.mapName ? `${d.mapName.zh} ${d.mapName.en}` : '對局重播';
  const rows = d.players
    .slice(0, 5)
    .map((p, i) => {
      const y = 330 + i * 52;
      const color = SEAT_COLORS[p.seat % SEAT_COLORS.length];
      const name = escapeXml(fitText(p.name, 32, 520));
      const star = p.winner
        ? `<text x="700" y="${y + 11}" font-size="30" fill="${BLUE}">★</text>`
        : '';
      return `<circle cx="92" cy="${y}" r="14" fill="${color}"/>
<text x="122" y="${y + 11}" font-size="32" font-weight="${p.winner ? 700 : 400}" fill="${INK}">${name}</text>
<text x="670" y="${y + 11}" font-size="32" font-weight="700" text-anchor="end" fill="${p.winner ? BLUE : INK_SOFT}">${p.score}</text>
${star}`;
    })
    .join('\n');

  return frame(`
${kicker(`對局重播 · GAME REPLAY　—　${date}`)}
<text x="72" y="278" font-size="54" font-weight="700" fill="${INK}">${escapeXml(fitText(title, 54, 1050))}</text>
${rows}
`);
}
