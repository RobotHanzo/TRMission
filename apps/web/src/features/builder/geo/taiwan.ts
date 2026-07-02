// Detailed Taiwan for the world-crop tool. Natural Earth 1:110m renders Taiwan as a crude
// 4-point blob, so we splice in the game's own hand-authored silhouette instead: the board
// outline (game/geography.ts) is an equirectangular projection of the real coast into board
// units, which makes it trivially invertible back to lon/lat. Cropping around Taiwan therefore
// reproduces the same coastline the official board draws, and the outlying islands (absent from
// Natural Earth at this scale) come along at their real-world positions.
import { TAIWAN_OUTLINE } from '../../../game/geography';
import type { Ring } from './clip';

// Two well-known capes pin the affine inverse of the hand-drawn outline's projection:
// Cape Fugui (northernmost) and Eluanbi (southern tip).
const FUGUI_BOARD = { x: 62.1, y: 5.9 };
const FUGUI_GEO = { lon: 121.537, lat: 25.297 };
const ELUANBI_BOARD_Y = 89.2;
const ELUANBI_LAT = 21.902;

/** Board units per degree of latitude (y grows south, lat grows north). */
const UNITS_PER_DEG = (ELUANBI_BOARD_Y - FUGUI_BOARD.y) / (FUGUI_GEO.lat - ELUANBI_LAT);
const MID_LAT = (FUGUI_GEO.lat + ELUANBI_LAT) / 2;
const COS_MID = Math.cos((MID_LAT * Math.PI) / 180);

function boardToLonLat([x, y]: readonly [number, number]): [number, number] {
  return [
    FUGUI_GEO.lon + (x - FUGUI_BOARD.x) / (UNITS_PER_DEG * COS_MID),
    FUGUI_GEO.lat - (y - FUGUI_BOARD.y) / UNITS_PER_DEG,
  ];
}

/**
 * Sample the same Catmull-Rom curve `smoothClosedPath` renders, as a closed polyline —
 * the 28 authored vertices become a dense ring so the coastline stays smooth in the crop
 * tool's straight-segment rendering and survives into the cropped geography.
 */
function catmullRomSamples(
  pts: readonly (readonly [number, number])[],
  subdivisions: number,
): [number, number][] {
  const n = pts.length;
  const at = (i: number): readonly [number, number] => pts[((i % n) + n) % n]!;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    for (let k = 0; k < subdivisions; k++) {
      const t = k / subdivisions;
      const u = 1 - t;
      out.push([
        u * u * u * p1[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p2[0],
        u * u * u * p1[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * p2[1],
      ]);
    }
  }
  return out;
}

/** Outlying islands at their real coordinates (the board places them stylised for gameplay);
 *  radius carried over from the board's blob sizes, in board units. */
const OUTLYING_ISLANDS: readonly { lon: number; lat: number; r: number }[] = [
  { lon: 119.6, lat: 23.57, r: 1.5 }, // Penghu (cluster)
  { lon: 119.7, lat: 23.37, r: 0.85 },
  { lon: 119.51, lat: 23.66, r: 0.8 },
  { lon: 118.37, lat: 24.44, r: 1.5 }, // Kinmen
  { lon: 119.93, lat: 26.16, r: 1.0 }, // Matsu
  { lon: 120.01, lat: 26.23, r: 0.7 },
  { lon: 120.37, lat: 22.34, r: 1.0 }, // Liuqiu
  { lon: 121.49, lat: 22.66, r: 1.0 }, // Green Island
  { lon: 121.56, lat: 22.05, r: 1.2 }, // Orchid Island
];

function islandRing({ lon, lat, r }: { lon: number; lat: number; r: number }): Ring {
  const rLat = r / UNITS_PER_DEG;
  const rLon = rLat / Math.cos((lat * Math.PI) / 180);
  const points: [number, number][] = [];
  const STEPS = 12;
  for (let i = 0; i < STEPS; i++) {
    const a = (i / STEPS) * 2 * Math.PI;
    points.push([lon + rLon * Math.cos(a), lat + rLat * Math.sin(a)]);
  }
  return points;
}

/** Bounding box the crude Natural Earth Taiwan ring falls inside — used to find and drop it. */
export const TAIWAN_BBOX = { lonMin: 119.9, lonMax: 122.2, latMin: 21.7, latMax: 25.5 } as const;

/** True for the low-detail Natural Earth Taiwan ring (a handful of points inside the bbox). */
export function isCrudeTaiwanRing(ring: Ring): boolean {
  return (
    ring.length < 10 &&
    ring.every(
      ([lon, lat]) =>
        lon >= TAIWAN_BBOX.lonMin &&
        lon <= TAIWAN_BBOX.lonMax &&
        lat >= TAIWAN_BBOX.latMin &&
        lat <= TAIWAN_BBOX.latMax,
    )
  );
}

/** The detailed replacement: densified main-island coastline + the nine outlying island blobs. */
export function taiwanRings(): Ring[] {
  const main = catmullRomSamples(TAIWAN_OUTLINE, 4).map(boardToLonLat);
  return [main, ...OUTLYING_ISLANDS.map(islandRing)];
}
