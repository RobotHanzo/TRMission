// A faithful SVG snapshot of a custom map for its shared-link social card. The geometry
// comes from @trm/map-data's shared curve/bow/hub math — the very functions the live board
// renders from — and every visual constant below (colours, stroke widths, car thickness,
// tie sizes, pip radii) mirrors apps/web/src/styles/game.css at base zoom (--inv-scale and
// --marker-scale both 1) in the light theme, so the card reads exactly like the in-game
// map. Stations (city markers) are drawn; name labels deliberately are not.
import {
  buildRouteGeometryFor,
  smoothClosedPath,
  TAIWAN_BASE_VIEW,
  TAIWAN_LAND_PATH,
  TAIWAN_CENTRAL_RANGE_PATH,
  TAIWAN_ISLANDS,
  TAIWAN_GRATICULE,
} from '@trm/map-data';
import type { MapGeography, RouteGeometry } from '@trm/map-data';

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

const RELIEF = '#d9c9a1';

/** The quiet cartographic grid: the same hand-picked lines as the real board
 *  (Geography.tsx's `GRATICULE`) for official Taiwan; a fixed 20-unit step for a custom
 *  draft (its authored `land` rings carry no hand-tuned graticule of their own). */
function graticuleLayer(
  view: { x: number; y: number; w: number; h: number },
  official: boolean,
): string {
  const xs: number[] = official ? [...TAIWAN_GRATICULE.xs] : [];
  const ys: number[] = official ? [...TAIWAN_GRATICULE.ys] : [];
  if (!official) {
    const step = 20;
    for (let y = Math.ceil(view.y / step) * step; y < view.y + view.h; y += step) ys.push(y);
    for (let x = Math.ceil(view.x / step) * step; x < view.x + view.w; x += step) xs.push(x);
  }
  const lines = [
    ...ys.map(
      (y) =>
        `<line x1="${f(view.x - 6)}" y1="${f(y)}" x2="${f(view.x + view.w + 6)}" y2="${f(y)}"/>`,
    ),
    ...xs.map(
      (x) =>
        `<line x1="${f(x)}" y1="${f(view.y - 4)}" x2="${f(x)}" y2="${f(view.y + view.h + 4)}"/>`,
    ),
  ];
  return `<g stroke="${SEA_LINE}" stroke-width="0.32" stroke-dasharray="0.9 1.7">${lines.join('')}</g>`;
}

/** Smoothed land rings for a custom map's authored geography (Geography.tsx's CustomGeography). */
function customLandLayer(geography?: MapGeography): string {
  const parts: string[] = [];
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

/** The hand-authored official Taiwan coastline + central-range relief + outlying islands,
 *  drawn with the exact recipe Geography.tsx's `Geography()` uses. Custom drafts never reach
 *  this — they draw their own authored rings via {@link customLandLayer}. */
function officialTaiwanLandLayer(): string {
  const islands = TAIWAN_ISLANDS.map(
    (b) =>
      `<circle cx="${f(b.cx)}" cy="${f(b.cy)}" r="${f(b.r)}" fill="${LAND}" stroke="${COAST}" stroke-width="0.4"/>`,
  ).join('');
  return `<path d="${TAIWAN_LAND_PATH}" fill="none" stroke="${SEA}" stroke-width="2.4" opacity="0.6"/>
<path d="${TAIWAN_LAND_PATH}" fill="${LAND}" stroke="${COAST}" stroke-width="0.45" stroke-linejoin="round"/>
<path d="${TAIWAN_CENTRAL_RANGE_PATH}" fill="${RELIEF}" opacity="0.55"/>
<path d="${TAIWAN_CENTRAL_RANGE_PATH}" fill="none" stroke="${COAST}" stroke-width="0.3" stroke-dasharray="0.5 0.9" opacity="0.55"/>
<g>${islands}</g>`;
}

/** Cartography: quiet graticule + land (a custom draft's authored rings, or the official
 *  Taiwan coastline/relief/islands). The sea itself is painted by {@link mapPanelSvg} as a
 *  panel-sized rect BELOW the scaled group — a flat fill reads identically, and it keeps
 *  every coordinate modest (a huge transformed rect under a rounded clip trips a resvg
 *  geometry panic). */
function geographyLayer(
  view: { x: number; y: number; w: number; h: number },
  official: boolean,
  geography?: MapGeography,
): string {
  return [
    graticuleLayer(view, official),
    official ? officialTaiwanLandLayer() : customLandLayer(geography),
  ].join('\n');
}

// The thumbnail is small enough (~500px) that a dense junction — a real hub, or a custom
// draft's cluster of short hops — draws as an illegible smear of overlapping ties and dots.
// Only the OG card thins itself out this way; the live board (where every station and route
// must stay reachable/clickable) never drops anything.
/** Minimum on-screen gap (px) between two kept station markers. */
const MIN_STATION_GAP_PX = 26;
/** Minimum on-screen gap (px) between two kept route midpoints. */
const MIN_ROUTE_GAP_PX = 20;
/** Routes at or under this length are "small" — the only ones eligible to be dropped, and
 *  only when their midpoint is crowded by an already-kept route. */
const SMALL_ROUTE_MAX_LENGTH = 2;

/**
 * Longest-first greedy thinning: every route over {@link SMALL_ROUTE_MAX_LENGTH} always
 * renders. A short route only drops when its midpoint falls within `gap` (board units) of an
 * already-kept one — a lone short spur out in open country still shows; a cluster of short
 * hops packed into a junction thins down to a legible few. A double-route pair's siblings
 * share the same un-bowed midpoint, so a small pair simplifies to a single visible track.
 */
function declutterRoutes(
  routes: RenderableMap['routes'],
  geometry: Map<string, RouteGeometry>,
  gap: number,
): Set<string> {
  const ranked = [...routes].sort((a, b) => b.length - a.length);
  const kept: { x: number; y: number }[] = [];
  const ids = new Set<string>();
  for (const r of ranked) {
    const g = geometry.get(r.id);
    if (!g) continue;
    const crowded = kept.some((k) => Math.hypot(k.x - g.mid.x, k.y - g.mid.y) < gap);
    if (r.length <= SMALL_ROUTE_MAX_LENGTH && crowded) continue;
    kept.push(g.mid);
    ids.add(r.id);
  }
  return ids;
}

/**
 * A hub always renders (it's drawn larger precisely because it matters); an ordinary station
 * drops only when it falls within `gap` (board units) of an already-kept marker, so a dense
 * junction thins down while an isolated town always still shows.
 */
function declutterCities(
  cities: RenderableMap['cities'],
  hubs: ReadonlySet<string>,
  gap: number,
): Set<string> {
  const ranked = [...cities].sort((a, b) => {
    const ah = hubs.has(a.id);
    const bh = hubs.has(b.id);
    if (ah !== bh) return ah ? -1 : 1; // hubs first
    const ai = !!a.isIsland;
    const bi = !!b.isIsland;
    if (ai !== bi) return ai ? -1 : 1; // then islands
    return 0;
  });
  const kept: { x: number; y: number }[] = [];
  const ids = new Set<string>();
  for (const c of ranked) {
    const crowded = kept.some((k) => Math.hypot(k.x - c.x, k.y - c.y) < gap);
    if (!hubs.has(c.id) && crowded) continue; // hubs are exempt from the spacing filter
    kept.push({ x: c.x, y: c.y });
    ids.add(c.id);
  }
  return ids;
}

/** One route: RouteShape's exact stack — tunnel glow → roadbed → ties / ferry pips / cars. */
function routeLayer(
  map: RenderableMap,
  geometry: Map<string, RouteGeometry>,
  keep: ReadonlySet<string>,
): string {
  const out: string[] = [];
  for (const r of map.routes) {
    if (!keep.has(r.id)) continue;
    const g = geometry.get(r.id);
    if (!g) continue;
    const fill = ROUTE_COLORS[r.color] ?? ROUTE_COLORS.GRAY!;
    const isFerry = r.ferryLocos > 0;
    const parts: string[] = [];

    if (r.isTunnel)
      parts.push(
        `<path d="${g.path}" fill="none" stroke="#b0b0b0" stroke-opacity="0.18" stroke-width="2.4" stroke-linecap="round"/>`,
      );
    // Paper roadbed seats the cars legibly over land and sea.
    parts.push(
      `<path d="${g.path}" fill="none" stroke="${SURFACE}" stroke-width="2.8" stroke-linecap="round" opacity="0.95"/>`,
    );
    if (r.isTunnel)
      for (const t of g.ties ?? [])
        parts.push(
          `<rect x="-1.8" y="-0.14" width="3.6" height="0.28" fill="#3d352b" fill-opacity="0.9" transform="translate(${f(t.x)} ${f(t.y)}) rotate(${(t.angle + 45).toFixed(1)})"/>`,
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
function cityLayer(
  map: RenderableMap,
  hubs: ReadonlySet<string>,
  keep: ReadonlySet<string>,
): string {
  return map.cities
    .filter((c) => keep.has(c.id))
    .map((c) => {
      if (hubs.has(c.id))
        return `<rect x="-1.25" y="-0.8" width="2.5" height="1.6" rx="0.8" fill="${SURFACE}" stroke="${INK}" stroke-width="0.4" transform="translate(${f(c.x)} ${f(c.y)})"/>`;
      const island = !!c.isIsland;
      return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${island ? 1.4 : 1.15}" fill="${SURFACE}" stroke="${island ? BLUE : INK}" stroke-width="0.4"/>`;
    })
    .join('\n');
}

/** Fallback view for a draft with no geography: the cities' bounding box plus margin. */
function viewFor(
  map: RenderableMap,
  official: boolean,
): { x: number; y: number; w: number; h: number } {
  if (official) return TAIWAN_BASE_VIEW;
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
 * `official` draws the hand-authored Taiwan coastline/relief/islands instead of the map's
 * own `geography` — set it for the bundled official Taiwan content, never for a custom draft.
 */
export function mapPanelSvg(
  map: RenderableMap,
  panel: { x: number; y: number; w: number; h: number; r: number },
  clipId: string,
  official = false,
): string {
  const view = viewFor(map, official);
  // Contain: the whole authored view stays visible (a preview should show the entire map);
  // the slack axis fills with open sea rather than letterboxing, since the sea has no edge.
  const scale = Math.min(panel.w / view.w, panel.h / view.h);
  const tx = panel.x + panel.w / 2 - (view.x + view.w / 2) * scale;
  const ty = panel.y + panel.h / 2 - (view.y + view.h / 2) * scale;

  const { geometry, hubs } = buildRouteGeometryFor(map.cities, map.routes);
  const keepRoutes = declutterRoutes(map.routes, geometry, MIN_ROUTE_GAP_PX / scale);
  const keepCities = declutterCities(map.cities, hubs, MIN_STATION_GAP_PX / scale);

  return `<clipPath id="${clipId}"><rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="${panel.r}"/></clipPath>
<g clip-path="url(#${clipId})">
<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" fill="${SEA}"/>
<g transform="translate(${f(tx)} ${f(ty)}) scale(${f(scale)})">
${geographyLayer(view, official, map.geography)}
${routeLayer(map, geometry, keepRoutes)}
${cityLayer(map, hubs, keepCities)}
</g>
</g>`;
}
