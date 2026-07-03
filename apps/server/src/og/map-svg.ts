// A faithful SVG snapshot of a custom map for its shared-link social card. The geometry
// comes from @trm/map-data's shared curve/bow/hub math — the very functions the live board
// renders from — and every visual constant below (colours, stroke widths, car thickness,
// tie sizes, pip radii) mirrors apps/web/src/styles/game.css at base zoom (--inv-scale and
// --marker-scale both 1) in the light theme, so the card reads exactly like the in-game
// map. Stations (city markers) are drawn; name labels deliberately are not.
import { buildRouteGeometryFor, smoothClosedPath } from '@trm/map-data';
import type { MapGeography } from '@trm/map-data';

/** The subset of a map draft the renderer needs (matches CustomMapDoc.draft / MapDraft). */
export interface RenderableMap {
  cities: readonly { id: string; x: number; y: number; isIsland?: boolean }[];
  routes: readonly {
    id: string;
    a: string;
    b: string;
    color: string;
    length: number;
    doubleGroup?: string;
    ferryLocos: number;
    isTunnel: boolean;
  }[];
  geography?: MapGeography | undefined;
}

// Light-theme cartography tokens (apps/web/src/styles/tokens.css).
const SEA = '#d6e4ec';
const SEA_LINE = 'rgba(31, 90, 130, 0.2)';
const LAND = '#efe6cf';
const COAST = '#b9a47b';
const SURFACE = '#fffdf8';
const INK = '#1f2328';
const BLUE = '#0f5fa6';

// The 8 train colours + gray (theme/colors.ts CARD_COLOR_TOKENS / GRAY_TOKEN).
const ROUTE_COLORS: Record<string, string> = {
  RED: '#D72631',
  ORANGE: '#EE7B30',
  YELLOW: '#F2C14E',
  GREEN: '#3A9D5C',
  BLUE: '#0F5FA6',
  PURPLE: '#7B4DA6',
  BLACK: '#2B2D31',
  WHITE: '#E8EAED',
  GRAY: '#8A8E96',
};
/** The six locomotive liveries in spectrum order — the ferry wild-pip rainbow. */
const LIVERY_COLORS = ['#D72631', '#EE7B30', '#F2C14E', '#3A9D5C', '#0F5FA6', '#7B4DA6'];

const f = (v: number): string => v.toFixed(2);

/** The rainbow gradient the ferry locomotive pips reference (RouteShape's FerryLocoGradientDef). */
export function ferryLocoGradientDef(): string {
  const stops = LIVERY_COLORS.map(
    (hex, i) => `<stop offset="${f(i / (LIVERY_COLORS.length - 1))}" stop-color="${hex}"/>`,
  ).join('');
  return `<linearGradient id="ferryLocoRainbow" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>`;
}

/** Cartography: quiet graticule + smoothed land rings (Geography.tsx's CustomGeography).
 *  The sea itself is painted by {@link mapPanelSvg} as a panel-sized rect BELOW the scaled
 *  group — a flat fill reads identically, and it keeps every coordinate modest (a huge
 *  transformed rect under a rounded clip trips a resvg geometry panic). */
function geographyLayer(
  view: { x: number; y: number; w: number; h: number },
  geography?: MapGeography,
): string {
  const parts: string[] = [];
  const step = 20;
  const grid: string[] = [];
  for (let y = Math.ceil(view.y / step) * step; y < view.y + view.h; y += step)
    grid.push(
      `<line x1="${f(view.x - 6)}" y1="${f(y)}" x2="${f(view.x + view.w + 6)}" y2="${f(y)}"/>`,
    );
  for (let x = Math.ceil(view.x / step) * step; x < view.x + view.w; x += step)
    grid.push(
      `<line x1="${f(x)}" y1="${f(view.y - 4)}" x2="${f(x)}" y2="${f(view.y + view.h + 4)}"/>`,
    );
  parts.push(
    `<g stroke="${SEA_LINE}" stroke-width="0.32" stroke-dasharray="0.9 1.7">${grid.join('')}</g>`,
  );
  for (const ring of geography?.land ?? []) {
    const d = smoothClosedPath(ring);
    if (!d) continue;
    // land-surf (a soft sea-coloured halo) under the land fill, like the board.
    parts.push(`<path d="${d}" fill="none" stroke="${SEA}" stroke-width="2.4" opacity="0.6"/>`);
    parts.push(
      `<path d="${d}" fill="${LAND}" stroke="${COAST}" stroke-width="0.45" stroke-linejoin="round"/>`,
    );
  }
  return parts.join('\n');
}

/** One route: RouteShape's exact stack — tunnel glow → roadbed → ties / ferry pips / cars. */
function routeLayer(map: RenderableMap): string {
  const { geometry } = buildRouteGeometryFor(map.cities, map.routes);
  const out: string[] = [];
  for (const r of map.routes) {
    const g = geometry.get(r.id);
    if (!g) continue;
    const fill = ROUTE_COLORS[r.color] ?? ROUTE_COLORS.GRAY!;
    const isFerry = r.ferryLocos > 0;
    const parts: string[] = [];

    if (r.isTunnel)
      parts.push(
        `<path d="${g.path}" fill="none" stroke="#b0b0b0" stroke-opacity="0.18" stroke-width="6" stroke-linecap="round"/>`,
      );
    // Paper roadbed seats the cars legibly over land and sea.
    parts.push(
      `<path d="${g.path}" fill="none" stroke="${SURFACE}" stroke-width="2.8" stroke-linecap="round" opacity="0.95"/>`,
    );
    if (r.isTunnel)
      for (const t of g.ties ?? [])
        parts.push(
          `<rect x="-4" y="-0.14" width="8" height="0.28" fill="#3d352b" fill-opacity="0.9" transform="translate(${f(t.x)} ${f(t.y)}) rotate(${(t.angle + 45).toFixed(1)})"/>`,
        );

    if (isFerry) {
      // Dotted sea crossing; the required-wild pips are a centred block of rainbow rects.
      parts.push(
        `<path d="${g.path}" fill="none" stroke="#9aa0a6" stroke-width="0.5" stroke-linecap="round" stroke-dasharray="0.1 2.55"/>`,
      );
      const locoStart = Math.max(0, Math.floor((r.length - r.ferryLocos) / 2));
      g.slots.forEach((s, i) => {
        const isLoco = i >= locoStart && i < locoStart + r.ferryLocos;
        parts.push(
          isLoco
            ? `<rect x="${f(-s.len / 2)}" y="-0.72" width="${f(s.len)}" height="1.44" rx="0.42" fill="url(#ferryLocoRainbow)" stroke="#fff" stroke-width="0.5" transform="translate(${f(s.x)} ${f(s.y)}) rotate(${s.angle.toFixed(1)})"/>`
            : `<circle cx="${f(s.x)}" cy="${f(s.y)}" r="0.7" fill="${fill}" stroke="#2a2520" stroke-width="0.25"/>`,
        );
      });
    } else {
      for (const s of g.slots)
        parts.push(
          `<rect x="${f(-s.len / 2)}" y="-0.72" width="${f(s.len)}" height="1.44" rx="0.42" fill="${fill}" stroke="#2a2520" stroke-width="0.3" stroke-linejoin="round" transform="translate(${f(s.x)} ${f(s.y)}) rotate(${s.angle.toFixed(1)})"/>`,
        );
    }

    // Double-route siblings split apart by their perpendicular nudge (inv-scale = 1 here).
    const translate =
      g.perp.x || g.perp.y
        ? ` transform="translate(${g.perp.x.toFixed(3)} ${g.perp.y.toFixed(3)})"`
        : '';
    out.push(`<g${translate}>${parts.join('')}</g>`);
  }
  return out.join('\n');
}

/** Stations only — round city dots (islands ringed blue) and slot-shaped hubs. No labels. */
function cityLayer(map: RenderableMap): string {
  const { hubs } = buildRouteGeometryFor(map.cities, map.routes);
  return map.cities
    .map((c) => {
      if (hubs.has(c.id))
        return `<rect x="-1.25" y="-0.8" width="2.5" height="1.6" rx="0.8" fill="${SURFACE}" stroke="${INK}" stroke-width="0.4" transform="translate(${f(c.x)} ${f(c.y)})"/>`;
      const island = !!c.isIsland;
      return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${island ? 1.4 : 1.15}" fill="${SURFACE}" stroke="${island ? BLUE : INK}" stroke-width="0.4"/>`;
    })
    .join('\n');
}

/** Fallback view for a draft with no geography: the cities' bounding box plus margin. */
function viewFor(map: RenderableMap): { x: number; y: number; w: number; h: number } {
  if (map.geography) return map.geography.baseView;
  const xs = map.cities.map((c) => c.x);
  const ys = map.cities.map((c) => c.y);
  if (xs.length === 0) return { x: 0, y: 0, w: 100, h: 100 };
  const pad = 8;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

/**
 * The complete map snapshot as SVG markup, scaled-to-cover and clipped into the given panel
 * rectangle (card px). Returns markup to drop inside the card's `<svg>`; the caller draws
 * any panel border on top. Requires {@link ferryLocoGradientDef} in the card's `<defs>`.
 */
export function mapPanelSvg(
  map: RenderableMap,
  panel: { x: number; y: number; w: number; h: number; r: number },
  clipId: string,
): string {
  const view = viewFor(map);
  // Contain: the whole authored view stays visible (a preview should show the entire map);
  // the slack axis fills with open sea rather than letterboxing, since the sea has no edge.
  const scale = Math.min(panel.w / view.w, panel.h / view.h);
  const tx = panel.x + panel.w / 2 - (view.x + view.w / 2) * scale;
  const ty = panel.y + panel.h / 2 - (view.y + view.h / 2) * scale;
  return `<clipPath id="${clipId}"><rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="${panel.r}"/></clipPath>
<g clip-path="url(#${clipId})">
<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" fill="${SEA}"/>
<g transform="translate(${f(tx)} ${f(ty)}) scale(${f(scale)})">
${geographyLayer(view, map.geography)}
${routeLayer(map)}
${cityLayer(map)}
</g>
</g>`;
}
