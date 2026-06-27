// Hand-authored cartography for the Taiwan board. Coordinates live in the SAME
// 0–100 space as the city positions in @trm/map-data, so the coastline, the central
// mountain relief, and the outlying islands all register against the real station
// placements. Nothing here is traced from any existing map — it's an original
// silhouette drawn to fit our city graph.

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Home view: frames the main island plus every outlying island (Kinmen west → Orchid SE). */
export const BASE_VIEW: View = { x: -4, y: -2, w: 84, h: 98 };

/** Pan/zoom bounds — kept in sync with the TransformWrapper props in Board.tsx. */
export const MIN_SCALE = 0.8;
export const MAX_SCALE = 8;

/**
 * The home/reset zoom, derived from the live viewport so the island *fills* the board on any
 * window shape. The board cell is `flex: 1`, so its aspect ratio changes with the window width;
 * a single fixed scale only ever frames one ratio (the old hard-coded 1.9 left a band of sea on
 * wider boards, reading as "too small"). This returns the react-zoom-pan-pinch scale that makes
 * BASE_VIEW *cover* the viewport — the generalisation of that 1.9, which was exactly this
 * cover-fit for the ~1200×760 board it was tuned on.
 */
export function homeScale(viewportW: number, viewportH: number): number {
  if (viewportW <= 0 || viewportH <= 0) return 1.9; // not measured yet — sane default
  const fitW = viewportW / BASE_VIEW.w;
  const fitH = viewportH / BASE_VIEW.h;
  const cover = Math.max(fitW, fitH) / Math.min(fitW, fitH);
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, cover));
}

/**
 * Main-island coastline, clockwise from the Tamsui river mouth. Points are smoothed
 * into a natural curve by `smoothClosedPath`; every land city sits inside this hull.
 */
const TAIWAN_OUTLINE: readonly (readonly [number, number])[] = [
  [49, 6], // Tamsui (NW corner)
  [54, 3.5],
  [61, 4],
  [66, 6], // Keelung (NE corner)
  [68, 11],
  [68.5, 17], // Sandiao cape
  [66.8, 26], // Yilan plain
  [69, 35], // Su'ao
  [72, 45], // Hualien — easternmost bulge
  [71.5, 54],
  [68, 63], // east coast running SSW
  [63, 72],
  [58, 80], // Taitung coast
  [53, 86],
  [49.5, 90], // Eluanbi — the southern cape (pointed)
  [45, 85],
  [42, 77], // Fangliao
  [36, 68], // Kaohsiung
  [31, 60], // Tainan
  [29, 52], // Chiayi / Budai (west bulge)
  [28.5, 44], // Changhua / Lukang — widest west point
  [31, 35],
  [35, 27], // Hsinchu coast
  [40, 18],
  [44, 11], // back toward the NW corner
];

/**
 * The Central Mountain Range, as a soft relief blob down the island's east-of-centre
 * spine. This is the map's thesis: the wall of mountains is exactly why the three
 * east-coast crossings are tunnels (and why the cross-island routes are the contested,
 * high-value ones). Drawn subtly, behind the rail network.
 */
const CENTRAL_RANGE: readonly (readonly [number, number])[] = [
  [50, 19],
  [55, 24],
  [58, 33],
  [59, 45],
  [57.5, 57],
  [54, 67],
  [50.5, 75],
  [48.5, 70],
  [47.5, 58],
  [47, 46],
  [47.5, 34],
  [48.5, 25],
];

/** Outlying islands as small blobs (centre + radius in board units). The city marker sits on top. */
export const ISLANDS: readonly { cx: number; cy: number; r: number }[] = [
  { cx: 20, cy: 56, r: 1.6 }, // Penghu (drawn as a small cluster below)
  { cx: 22.4, cy: 54.6, r: 0.9 },
  { cx: 18, cy: 58.2, r: 0.8 },
  { cx: 5, cy: 48, r: 1.5 }, // Kinmen
  { cx: 22, cy: 10, r: 1.1 }, // Matsu
  { cx: 23.6, cy: 8.4, r: 0.7 },
  { cx: 31, cy: 69, r: 1.0 }, // Liuqiu
  { cx: 70, cy: 78, r: 1.0 }, // Green Island
  { cx: 73, cy: 88, r: 1.2 }, // Orchid Island
];

/** A faint cartographic grid for the "real map" feel — kept very quiet behind the land. */
export const GRATICULE = {
  xs: [10, 30, 50, 70] as const,
  ys: [10, 30, 50, 70, 90] as const,
};

/**
 * Catmull–Rom → cubic Bézier over a closed loop of points, yielding an organic
 * coastline without hand-tuned control points.
 */
export function smoothClosedPath(pts: readonly (readonly [number, number])[]): string {
  const n = pts.length;
  if (n < 3) return '';
  const at = (i: number): readonly [number, number] => pts[((i % n) + n) % n]!;
  const f = (v: number): string => v.toFixed(2);
  const start = at(0);
  let d = `M ${f(start[0])} ${f(start[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

export const TAIWAN_LAND_PATH = smoothClosedPath(TAIWAN_OUTLINE);
export const CENTRAL_RANGE_PATH = smoothClosedPath(CENTRAL_RANGE);
