// Hand-authored cartography for the OFFICIAL Taiwan board: the coastline, central-range
// relief, and outlying-island blobs. Coordinates live in the same 0–100 space as the city
// positions. Nothing here is traced from any existing map — an original silhouette drawn to
// fit the authored city graph. This is the single source both the web board (Geography.tsx,
// which draws it with extra viewport/pan-zoom concerns layered on top) and the server's
// official-map social card render from, so neither can drift from the other.
import { smoothClosedPath } from './geometry';

/** Home view: frames the main island plus every outlying island (Kinmen west → Orchid SE). */
export const TAIWAN_BASE_VIEW = { x: -4, y: -2, w: 84, h: 98 };

/**
 * Main-island coastline, clockwise from the Tamsui river mouth. The vertices are an equal-scale
 * geographic projection of the real coast into the same 0–100 board as the cities (north-up,
 * Taiwan's natural ~12° lean), so the silhouette reads as the actual island: a NE Sandiao/Su'ao
 * corner as the easternmost point, a bulging western plain, and a tapering Hengchun peninsula in
 * the south. Points are smoothed into a natural curve by `smoothClosedPath`; every land city sits
 * inside this hull.
 */
export const TAIWAN_OUTLINE: readonly (readonly [number, number])[] = [
  [56.7, 10], // Tamsui river mouth (NW)
  [62.1, 5.9], // Cape Fugui — northernmost point
  [64.8, 7.3],
  [67.9, 9.3], // Keelung headland
  [71.8, 11.3],
  [73.6, 14.2], // Cape Sandiao — the NE, easternmost corner
  [71.3, 20.1], // Yilan plain (a gentle bay)
  [72.9, 25.5], // Su'ao headland
  [68.4, 35.8], // east coast, off Hualien
  [66.2, 43.1],
  [63.9, 52.9], // east coast running SSW
  [61.2, 62.7],
  [57.2, 69.6], // Taitung coast
  [51.1, 77.4], // SE toward Dawu
  [48.9, 82.8], // east side of the Hengchun peninsula
  [46.4, 89.2], // Eluanbi — the southern cape (pointed)
  [40.6, 84.8], // Hengchun peninsula, west side
  [38.8, 76.9], // Fangliao
  [36.1, 73.7],
  [32.1, 72], // Kaohsiung coast
  [29.4, 62.7], // Tainan coast (west bulge)
  [29.4, 52.9], // Budai — the westernmost point
  [32.5, 40.2], // Changhua coast
  [35.6, 35.3], // Lukang
  [38.8, 30.4], // Taichung coast
  [42.4, 25.5], // Miaoli coast
  [46, 18.1], // Hsinchu coast
  [50.9, 12.2], // back toward the NW corner
];

/**
 * The Central Mountain Range, as a soft relief blob down the island's east-of-centre
 * spine. This is the map's thesis: the wall of mountains is exactly why the three
 * east-coast crossings are tunnels (and why the cross-island routes are the contested,
 * high-value ones). Drawn subtly, behind the rail network.
 */
export const TAIWAN_CENTRAL_RANGE: readonly (readonly [number, number])[] = [
  [57.2, 33.8],
  [54.9, 43.6],
  [52.7, 53.4],
  [51.3, 63.2],
  [50, 72],
  [46.9, 69.6],
  [45.5, 60.3],
  [46.4, 50],
  [47.8, 40.2],
  [51.3, 33.8],
];

/** Outlying islands as small blobs (centre + radius in board units). The city marker sits on top. */
export const TAIWAN_ISLANDS: readonly { cx: number; cy: number; r: number }[] = [
  { cx: 16, cy: 50, r: 1.5 }, // Penghu (drawn as a small cluster)
  { cx: 18.3, cy: 48.7, r: 0.85 },
  { cx: 14.1, cy: 51.6, r: 0.8 },
  { cx: 4, cy: 33, r: 1.5 }, // Kinmen
  { cx: 24, cy: 7, r: 1.0 }, // Matsu
  { cx: 25.7, cy: 5.5, r: 0.7 },
  { cx: 33, cy: 78, r: 1.0 }, // Liuqiu
  { cx: 65, cy: 70, r: 1.0 }, // Green Island
  { cx: 68, cy: 85, r: 1.2 }, // Orchid Island
  { cx: 73.7, cy: 28, r: 0.9 }, // Guishan Island (龜山島) — off the Yilan/Su'ao coast (map v4)
];

/** A faint cartographic grid for the "real map" feel — kept very quiet behind the land. */
export const TAIWAN_GRATICULE = {
  xs: [10, 30, 50, 70] as const,
  ys: [10, 30, 50, 70, 90] as const,
};

export const TAIWAN_LAND_PATH = smoothClosedPath(TAIWAN_OUTLINE);
export const TAIWAN_CENTRAL_RANGE_PATH = smoothClosedPath(TAIWAN_CENTRAL_RANGE);
