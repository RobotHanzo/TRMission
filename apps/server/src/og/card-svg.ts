// Hand-authored 1200×630 SVG social cards (GitHub-style). All artwork is original
// geometric brand styling — route-ribbon motifs echoing the board, never copied art.
// Text is XML-escaped here; rasterisation happens in OgService via resvg.
/* eslint no-irregular-whitespace: ["error", { "skipStrings": true, "skipTemplates": true }] --
   the card copy deliberately uses U+3000 ideographic spaces for CJK typography */
import { ferryLocoGradientDef, mapPanelSvg, type RenderableMap } from './map-svg';

export const CARD_W = 1200;
export const CARD_H = 630;

// Brand tokens mirrored from apps/web/src/styles/tokens.css (light theme — social
// cards render on platform-neutral backgrounds, so the light palette reads best).
const BLUE = '#0f5fa6';
const EMBER = '#ee6b1f';
const PAPER = '#f6f1e7';
const SURFACE = '#fffdf8';
const SURFACE_2 = '#efe8da';
const INK = '#1f2328';
const INK_SOFT = '#5b6168';
const LINE = '#d9d0be';
const READY_GREEN = '#1f8a5b';
const AVATAR_HUMAN = '#8b8377';
const AVATAR_BOT = '#5b6168';
/** apps/web/src/components/BrandBanner.tsx wordmark colours — the 台鐵任務 line stays this
 *  orange (icon.svg's own accent) and TRMISSION stays brand navy, independent of the card's
 *  own ember accent. */
const BANNER_ORANGE = '#e55509';
const BANNER_NAVY = '#17346f';
/** Seat colours (apps/web/src/theme/colors.ts SEAT_COLORS) for player chips/dots. */
const SEAT_COLORS = ['#0E8C8C', '#C0398B', '#E8A33D', '#5A6B7B', '#7CB342'] as const;

/** The "黑體 Gothic" system (redesign turn 2 / option 2a): sans CJK display + mono data,
 *  reordered PingFang-first per that exploration. Shared by every card below. */
const F_SANS =
  "'PingFang TC','Heiti TC','Microsoft JhengHei','Noto Sans TC','Noto Sans CJK TC','Noto Sans',sans-serif";
const F_MONO = "'DejaVu Sans Mono','Consolas','Menlo','Courier New',monospace";
/** Plain Latin captions (map subtitles, etc.) — NOT the BrandBanner wordmark's face. */
const F_HELV = "'Helvetica','Arial','DejaVu Sans',sans-serif";
/** The BrandBanner TRMISSION line's Latin face; not a system font on most render boxes, so it
 *  falls through to the same Helvetica/DejaVu stack the rest of the card uses. */
const F_LATIN = "'Archivo','Helvetica','Arial','DejaVu Sans',sans-serif";

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
  for (const ch of s) w += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 1 : 0.55;
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

/**
 * A card text node. Whatever system font resvg resolves (Regular only, in some environments —
 * a bare `font-weight` request then silently collapses back to Regular with no visible change),
 * the glyphs are additionally stroked in their own fill colour so every card reads clearly at
 * social-platform thumbnail scale regardless of which weights the installed font actually
 * ships. `content` must already be escaped; every caller should pass `font` explicitly.
 */
function text(
  x: number,
  y: number,
  size: number,
  fill: string,
  content: string,
  opts: { anchor?: 'middle' | 'end'; spacing?: number; font?: string } = {},
): string {
  const anchor = opts.anchor ? ` text-anchor="${opts.anchor}"` : '';
  const spacing = opts.spacing ? ` letter-spacing="${opts.spacing}"` : '';
  const font = opts.font ? ` font-family="${opts.font}"` : '';
  const strokeWidth = Math.max(0.6, size * 0.035);
  return (
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="700"${anchor}${spacing}${font} ` +
    `fill="${fill}" stroke="${fill}" stroke-width="${strokeWidth}" stroke-linejoin="round" ` +
    `paint-order="stroke">${content}</text>`
  );
}

// =============================================================================
// Redesign turn 2/3: shared wrapper + the BrandBanner lockup.
// =============================================================================

/** Plain paper card, no shared header — each card below carries its own bespoke frame
 *  per its exploration (a route-map hero, a ticket-stub silhouette, a quiet scoreboard
 *  rule, a map's data column + preview panel). */
function card2a(inner: string): string {
  return `<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
<rect width="${CARD_W}" height="${CARD_H}" fill="${PAPER}"/>
${inner}
</svg>`;
}

/** apps/web/public/icon.svg's inner geometry (a static 120×120 mark, no filters or web
 *  fonts — safe to inline verbatim into the resvg subset). Kept 1:1 with that file so the
 *  card mark can never drift from the app icon. */
const ICON_MARK =
  '<rect width="120" height="120" rx="27" fill="#E55509"/>' +
  '<g transform="rotate(-10 60 60)">' +
  '<path d="M26,36 L94,36 A8,8 0 0 1 102,44 L102,54 A6,6 0 0 0 102,66 L102,76 A8,8 0 0 1 94,84 L26,84 A8,8 0 0 1 18,76 L18,66 A6,6 0 0 0 18,54 L18,44 A8,8 0 0 1 26,36 Z" transform="translate(3,4)" fill="#AE3C04"/>' +
  '<path d="M26,36 L94,36 A8,8 0 0 1 102,44 L102,54 A6,6 0 0 0 102,66 L102,76 A8,8 0 0 1 94,84 L26,84 A8,8 0 0 1 18,76 L18,66 A6,6 0 0 0 18,54 L18,44 A8,8 0 0 1 26,36 Z" fill="#FFFFFF"/>' +
  '<line x1="82" y1="42" x2="82" y2="78" stroke="#E55509" stroke-width="2" stroke-dasharray="3 4"/>' +
  '<circle cx="92" cy="50" r="4" fill="#E55509"/>' +
  '<g transform="translate(99,0) scale(-1,1)">' +
  '<path d="M31,46 L48,46 C59,46 66,52 69.5,62 C70.8,65.8 68.5,68.5 64.5,68.5 L31,68.5 C28.2,68.5 27,67 27,64.5 L27,50 C27,47.5 28.2,46 31,46 Z" fill="#E55509"/>' +
  '<rect x="32" y="50.5" width="10" height="8.5" rx="2" fill="#FFFFFF"/>' +
  '<path d="M47,50.5 C53,50.5 57,53.5 59.5,59 L47,59 Z" fill="#FFFFFF"/>' +
  '<line x1="29" y1="76" x2="68" y2="76" stroke="#410200" stroke-width="4" stroke-linecap="round"/>' +
  '</g></g>';

interface Banner {
  width: number;
  height: number;
  markup: string;
}

/**
 * The BrandBanner lockup (apps/web's icon.svg + stacked 台鐵任務／TRMISSION wordmark),
 * reproduced as inline geometry: the CSS `skewX(-6deg)` on each line becomes an SVG
 * `skewX(-6)` transform, letter-spacing is carried over from the component's em values.
 * Shrinks (icon and both text lines scale together) until it fits `maxWidth`, so it never
 * overruns whatever slot on the card it's dropped into.
 */
function brandBanner(x: number, y: number, targetIconSize: number, maxWidth: number): Banner {
  const measure = (iconSize: number) => {
    const gap = iconSize * 0.16;
    const zhSize = iconSize * 0.6;
    const enSize = iconSize * 0.2;
    const zhSpacing = zhSize * 0.056;
    const zhWidth = estimateWidth('台鐵任務', zhSize) + zhSpacing * 3;
    return { iconSize, gap, zhSize, enSize, zhSpacing, zhWidth, total: iconSize + gap + zhWidth };
  };
  let m = measure(targetIconSize);
  while (m.total > maxWidth && m.iconSize > 40) m = measure(m.iconSize - 2);

  const textX = x + m.iconSize + m.gap;
  const lineGap = m.zhSize * 0.16;
  const zhCap = m.zhSize * 0.74;
  const enCap = m.enSize * 0.74;
  const blockTop = y + (m.iconSize - (zhCap + lineGap + enCap)) / 2;
  const zhBaseline = blockTop + zhCap;
  const enBaseline = zhBaseline + lineGap + enCap;
  const enSpacing = m.enSize * 0.455;

  const markup =
    `<g transform="translate(${x} ${y}) scale(${m.iconSize / 120})">${ICON_MARK}</g>` +
    `<g transform="translate(${textX} ${zhBaseline}) skewX(-6)">${text(0, 0, m.zhSize, BANNER_ORANGE, '台鐵任務', { spacing: m.zhSpacing, font: F_SANS })}</g>` +
    `<g transform="translate(${textX} ${enBaseline}) skewX(-6)">${text(0, 0, m.enSize, BANNER_NAVY, 'TRMISSION', { spacing: enSpacing, font: F_LATIN })}</g>`;

  return { width: m.iconSize + m.gap + m.zhWidth, height: m.iconSize, markup };
}

/** The banner, rotated 90° and centred on (cx, cy) — for the room card's ticket-stub spine. */
function brandBannerRotated(cx: number, cy: number, iconSize: number, maxWidth: number): string {
  const b = brandBanner(0, 0, iconSize, maxWidth);
  return `<g transform="translate(${cx} ${cy}) rotate(-90) translate(${-b.width / 2} ${-b.height / 2})">${b.markup}</g>`;
}

// =============================================================================
// 1) SITE CARD  — brand lockup + tagline; also the private/unknown fallback.
// =============================================================================
const SITE_ROUTE_MOTIF = `
<g stroke-linecap="round">
<polyline points="700,90 820,180 820,320 960,420 1140,420" fill="none" stroke="${SEAT_COLORS[0]}" stroke-width="9"/>
<polyline points="820,180 1000,130 1150,210" fill="none" stroke="${SEAT_COLORS[1]}" stroke-width="9"/>
<polyline points="820,320 700,470 760,600" fill="none" stroke="${SEAT_COLORS[4]}" stroke-width="9"/>
<polyline points="960,420 1080,540" fill="none" stroke="${SEAT_COLORS[3]}" stroke-width="9" stroke-dasharray="2 16"/>
</g>
<g fill="${PAPER}" stroke="${INK}" stroke-width="4">
<circle cx="820" cy="180" r="14"/><circle cx="820" cy="320" r="14"/><circle cx="960" cy="420" r="14"/>
<circle cx="1000" cy="130" r="14"/><circle cx="700" cy="470" r="14"/><circle cx="1140" cy="420" r="14"/>
</g>
<circle cx="700" cy="90" r="18" fill="${EMBER}"/>
<rect width="560" height="${CARD_H}" fill="${PAPER}" opacity="0.94"/>
<rect width="12" height="${CARD_H}" fill="${BLUE}"/>`;

/** The generic brand card — the homepage unfurl and the nondisclosing fallback. */
export function siteCardSvg(): string {
  const banner = brandBanner(66, 176, 140, 456);
  return card2a(`
${SITE_ROUTE_MOTIF}
${text(66, 128, 24, INK_SOFT, '路線建設桌遊', { spacing: 3, font: F_MONO })}
${banner.markup}
${text(66, 446, 32, INK_SOFT, '搶佔路線，連接城市。', { font: F_SANS })}
${text(66, 590, 23, INK_SOFT, 'trmission.robothanzo.dev', { font: F_MONO })}
`);
}

// =============================================================================
// 2) ROOM INVITE CARD  — ticket-stub silhouette; room code is the hero, with
//    per-seat avatars (human / bot / empty, ready badge) below.
// =============================================================================
const ROOM_MX = 410;
const ROOM_MR = 1120;

function stubShell(): string {
  return `
<defs><mask id="stubPunch"><rect x="36" y="36" width="1128" height="558" rx="30" fill="#fff"/><circle cx="36" cy="315" r="40" fill="#000"/><circle cx="1164" cy="315" r="40" fill="#000"/></mask></defs>
<rect x="36" y="36" width="1128" height="558" rx="30" fill="${PAPER}" stroke="${LINE}" stroke-width="2" mask="url(#stubPunch)"/>
<line x1="372" y1="66" x2="372" y2="564" stroke="#c2b8a2" stroke-width="4" stroke-dasharray="2 13"/>`;
}

/** Head-and-shoulders avatar, clipped to the seat circle. */
function humanAvatarGlyph(cx: number, cy: number, r: number): string {
  const id = `clipH${cx}-${cy}`;
  return `<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
<g clip-path="url(#${id})" fill="${AVATAR_HUMAN}">
<circle cx="${cx}" cy="${cy - 10}" r="${r * 0.34}"/>
<circle cx="${cx}" cy="${cy + r * 0.9}" r="${r * 0.62}"/>
</g>`;
}

/** Antenna + rounded head + eyes avatar, clipped to the seat circle. */
function botAvatarGlyph(cx: number, cy: number, r: number): string {
  const id = `clipB${cx}-${cy}`;
  const hw = r * 0.9;
  const hh = r * 0.72;
  return `<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
<g clip-path="url(#${id})">
<line x1="${cx}" y1="${cy - r * 0.9}" x2="${cx}" y2="${cy - hh / 2 - 6}" stroke="${INK_SOFT}" stroke-width="3"/>
<circle cx="${cx}" cy="${cy - r * 0.9}" r="4" fill="${EMBER}"/>
<rect x="${cx - hw / 2}" y="${cy - hh / 2}" width="${hw}" height="${hh}" rx="9" fill="${AVATAR_BOT}"/>
<circle cx="${cx - hw * 0.2}" cy="${cy - 4}" r="5" fill="${PAPER}"/>
<circle cx="${cx + hw * 0.2}" cy="${cy - 4}" r="5" fill="${PAPER}"/>
<rect x="${cx - hw * 0.28}" y="${cy + hh * 0.28}" width="${hw * 0.56}" height="6" rx="3" fill="${PAPER}"/>
</g>`;
}

function readyBadgeGlyph(cx: number, cy: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="16" fill="${READY_GREEN}" stroke="${PAPER}" stroke-width="3"/>
<path d="M ${cx - 7} ${cy} L ${cx - 2} ${cy + 6} L ${cx + 8} ${cy - 6}" fill="none" stroke="${SURFACE}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function emptySeatGlyph(cx: number, cy: number, r: number, color: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="6 8" opacity="0.6"/>
<line x1="${cx - 14}" y1="${cy}" x2="${cx + 14}" y2="${cy}" stroke="${color}" stroke-width="4" stroke-linecap="round" opacity="0.55"/>
<line x1="${cx}" y1="${cy - 14}" x2="${cx}" y2="${cy + 14}" stroke="${color}" stroke-width="4" stroke-linecap="round" opacity="0.55"/>`;
}

export interface RoomSeatMember {
  seat: number;
  kind: 'human' | 'bot';
  ready: boolean;
}

export interface RoomCardData {
  code: string;
  maxSeats: number;
  seatMembers: RoomSeatMember[];
  mapName?: { zh: string; en: string };
  status: 'LOBBY' | 'STARTED' | 'CLOSED';
}

const STATUS_LABEL: Record<RoomCardData['status'], string> = {
  LOBBY: '開放中',
  STARTED: '進行中',
  CLOSED: '已關閉',
};
const STATUS_COLOR: Record<RoomCardData['status'], string> = {
  LOBBY: EMBER,
  STARTED: BLUE,
  CLOSED: INK_SOFT,
};

function seatAvatarRow(maxSeats: number, members: RoomSeatMember[], cy: number): string {
  const n = Math.max(1, Math.floor(maxSeats));
  const r = 44;
  const bySeat = new Map(members.map((m) => [m.seat, m]));
  return Array.from({ length: n }, (_, i) => {
    const cx = ROOM_MX + ((ROOM_MR - ROOM_MX) * (i + 0.5)) / n;
    const color = SEAT_COLORS[i % SEAT_COLORS.length] ?? SEAT_COLORS[0];
    const member = bySeat.get(i);
    if (!member) return emptySeatGlyph(cx, cy, r, color);
    const avatar =
      member.kind === 'bot' ? botAvatarGlyph(cx, cy, r - 6) : humanAvatarGlyph(cx, cy, r - 6);
    const badge = member.ready ? readyBadgeGlyph(cx + r * 0.72, cy + r * 0.72) : '';
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SURFACE}"/>${avatar}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="5"/>${badge}`;
  }).join('\n');
}

export function roomCardSvg(d: RoomCardData): string {
  const code = escapeXml(d.code.toUpperCase());
  let codeSize = 132;
  const fieldW = ROOM_MR - ROOM_MX;
  while (
    codeSize > 60 &&
    estimateWidth(d.code, codeSize) + codeSize * 0.06 * Math.max(0, d.code.length - 1) > fieldW
  ) {
    codeSize -= 2;
  }
  const codeSpacing = codeSize * 0.06;

  const statusLabel = STATUS_LABEL[d.status];
  const statusColor = STATUS_COLOR[d.status];
  const badgeW = Math.max(120, estimateWidth(statusLabel, 24) + 68);
  const badgeX = ROOM_MR - badgeW;

  return card2a(`
${stubShell()}
${brandBannerRotated(158, 315, 100, 480)}
${d.mapName ? text(70, 560, 30, BLUE, escapeXml(fitText(d.mapName.zh, 30, 280)), { font: F_SANS }) : ''}
${text(ROOM_MX, 150, 24, INK_SOFT, '房間代碼 · ROOM CODE', { spacing: 4, font: F_MONO })}
${text(ROOM_MX - 4, 300, codeSize, BLUE, code, { spacing: codeSpacing, font: F_MONO })}
<rect x="${badgeX}" y="60" width="${badgeW}" height="50" rx="25" fill="#f3e4d6"/>
<circle cx="${badgeX + 26}" cy="85" r="7" fill="${statusColor}"/>
${text(badgeX + 46, 93, 22, statusColor, statusLabel, { font: F_SANS })}
<line x1="${ROOM_MX}" y1="416" x2="${ROOM_MR}" y2="416" stroke="${LINE}" stroke-width="2"/>
${seatAvatarRow(d.maxSeats, d.seatMembers, 508)}
`);
}

export interface MapCardData {
  nameZh: string;
  nameEn: string;
  /** A share code (custom map) or an official map id — shown in the ID chip. */
  code: string;
  map: RenderableMap;
  /** Ticket/mission count — the third stat-ledger row. */
  missionCount: number;
  /** Draw the hand-authored Taiwan coastline/relief/islands instead of `map.geography` — set
   *  for the bundled official map, never for a user-authored custom map. */
  official?: boolean;
}

/** One 車站數/路線數/任務數-style row: CN label, EN caption, right-aligned mono value,
 *  divider above. Rows stack at a fixed 92px pitch starting at `y0`. */
function statLedger(y0: number, rows: { labelZh: string; labelEn: string; color: string; value: number }[]): string {
  return rows
    .map((row, i) => {
      const y = y0 + i * 92;
      return `
<line x1="72" y1="${y}" x2="612" y2="${y}" stroke="${LINE}" stroke-width="1.5"/>
${text(72, y + 46, 30, INK, row.labelZh, { font: F_SANS })}
${text(72, y + 70, 16, INK_SOFT, row.labelEn, { spacing: 2, font: F_MONO })}
${text(612, y + 56, 48, row.color, String(row.value), { anchor: 'end', font: F_MONO })}`;
    })
    .join('\n');
}

/**
 * A map's card (redesign turn 3 / option "3a"): name + ID chip + stat ledger on the left,
 * and on the right a live snapshot of the map itself rendered with the exact in-game
 * cartography (stations shown, no labels), framed in a dashed panel. Used both for a shared
 * custom map's link (by share code) and for the bundled official map.
 */
export function mapCardSvg(d: MapCardData): string {
  const panel = { x: 680, y: 66, w: 448, h: 500, r: 20 };
  const kickerText = d.official ? '官方地圖 · OFFICIAL MAP' : '分享地圖 · SHARED MAP';
  const idW = Math.max(estimateWidth(d.code, 22) + 96, 180);

  return card2a(`
<defs>${ferryLocoGradientDef()}</defs>
<rect width="14" height="${CARD_H}" fill="${BANNER_ORANGE}"/>
${text(72, 104, 22, INK_SOFT, escapeXml(kickerText), { spacing: 4, font: F_MONO })}
${text(70, 182, 70, INK, escapeXml(fitText(d.nameZh, 70, 560)), { font: F_SANS })}
${text(72, 230, 34, BLUE, escapeXml(fitText(d.nameEn, 34, 560)), { spacing: 2, font: F_HELV })}
<rect x="72" y="262" width="${idW}" height="46" rx="10" fill="${SURFACE_2}" stroke="${LINE}" stroke-width="1.5"/>
${text(90, 292, 20, INK_SOFT, 'ID', { spacing: 1, font: F_MONO })}
${text(128, 292, 22, INK, escapeXml(d.code.toUpperCase()), { spacing: 2, font: F_MONO })}
${statLedger(346, [
  { labelZh: '車站數', labelEn: 'STATIONS', color: BLUE, value: d.map.cities.length },
  { labelZh: '路線數', labelEn: 'ROUTES', color: BLUE, value: d.map.routes.length },
  { labelZh: '任務數', labelEn: 'MISSIONS', color: EMBER, value: d.missionCount },
])}
${mapPanelSvg(d.map, panel, 'mapClip', d.official)}
<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="${panel.r}" fill="none" stroke="${BLUE}" stroke-width="2.5" stroke-dasharray="10 8"/>
${text(1112, 98, 18, INK_SOFT, 'MAP PREVIEW', { anchor: 'end', spacing: 3, font: F_MONO })}
`);
}

// =============================================================================
// 3) REPLAY SCOREBOARD CARD — map + date + up to 5 ranked players, winner marked.
// =============================================================================
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
  const date = d.completedAt.slice(0, 10).replaceAll('-', '.');
  const time = d.completedAt.slice(11, 16);
  const title = d.mapName ? `${d.mapName.zh} ${d.mapName.en}` : '對局重播';
  const players = d.players.slice(0, 5);
  const ROW_Y0 = 239;
  const ROW_H = 81.25;
  const NAME_X = 510;
  const NAME_RIGHT = 1000;

  const rows = players
    .map((p, i) => {
      const cy = ROW_Y0 + i * ROW_H;
      const isWin = i === 0;
      const color = SEAT_COLORS[p.seat % SEAT_COLORS.length];
      const rank = isWin
        ? `<circle cx="418" cy="${cy}" r="24" fill="${EMBER}"/>${text(418, cy + 9, 26, SURFACE, String(i + 1), { anchor: 'middle', font: F_MONO })}`
        : text(418, cy + 9, 26, INK_SOFT, String(i + 1), { anchor: 'middle', font: F_MONO });
      const swatch = `<rect x="458" y="${cy - 18}" width="36" height="36" rx="9" fill="${color}"/>`;
      const nameMaxW = NAME_RIGHT - NAME_X - (isWin ? 110 : 0);
      const nameStr = fitText(p.name, 38, nameMaxW);
      const name = text(NAME_X, cy + 13, 38, INK, escapeXml(nameStr), { font: F_SANS });
      const crownX = NAME_X + estimateWidth(nameStr, 38) + 22;
      const crown = isWin
        ? `<rect x="${crownX}" y="${cy - 19}" width="86" height="36" rx="18" fill="${EMBER}"/>${text(crownX + 43, cy + 6, 22, SURFACE, '冠軍', { anchor: 'middle', font: F_SANS })}`
        : '';
      const score = text(1128, cy + 13, isWin ? 46 : 44, isWin ? EMBER : BLUE, String(p.score ?? 0), {
        anchor: 'end',
        font: F_MONO,
      });
      const highlight = isWin
        ? `<rect x="60" y="${cy - 33}" width="1080" height="66" rx="10" fill="${EMBER}" opacity="0.12"/>`
        : '';
      const divider =
        i > 0 && i < players.length - 1
          ? `<line x1="72" y1="${cy + ROW_H / 2}" x2="1128" y2="${cy + ROW_H / 2}" stroke="${LINE}" stroke-width="1.5"/>`
          : '';
      return `${highlight}${rank}${swatch}${name}${crown}${score}${divider}`;
    })
    .join('\n');

  return card2a(`
<rect width="14" height="${CARD_H}" fill="${BLUE}"/>
${text(72, 98, 22, INK_SOFT, '對局重播 · REPLAY', { spacing: 4, font: F_MONO })}
${text(70, 158, 52, INK, escapeXml(fitText(title, 52, 1000)), { font: F_SANS })}
${text(1128, 90, 22, INK_SOFT, date, { anchor: 'end', font: F_MONO })}
${time ? text(1128, 116, 22, INK_SOFT, time, { anchor: 'end', font: F_MONO }) : ''}
<line x1="70" y1="188" x2="1130" y2="188" stroke="${BLUE}" stroke-width="2"/>
${rows}
`);
}
