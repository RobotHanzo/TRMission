import type { MapGeography } from '../types';

/** Home view: the projection's own square frame plus its sea margin. */
export const TAIPEI_BASE_VIEW = { x: -4, y: -4, w: 100, h: 100 };

/**
 * The land and the city boundaries, GENERATED — not drawn by hand.
 *
 * These rings are the output of the map builder's own "pick whole cities" pipeline
 * (`apps/web/src/features/builder/geo/world.ts`'s `citiesToGeography(['TW-TPE','TW-TPQ','TW-KEE'],
 * true)`), i.e. Natural Earth 1:10m admin-1 polygons for 臺北市 / 新北市 / 基隆市, dissolved into
 * one landmass, Douglas–Peucker simplified, and projected by `geo/projection.ts` (equirectangular
 * scaled by cos(midLat)) into board space. Baked in as literals so `@trm/map-data` stays free of
 * any dependency on the builder or its dataset — regenerate by re-running that call if the source
 * data is ever refreshed.
 *
 * Because the stations are projected through the SAME projection and crop, every stop lands in
 * its real city: the board is the region, at the region's own shape and scale.
 */
const TAIPEI_REGION: readonly (readonly [number, number])[] = [
  [92, 43.89],
  [86.89, 41.07],
  [80.5, 41.07],
  [77.94, 34.02],
  [79.22, 28.38],
  [60.06, 24.15],
  [52.39, 21.33],
  [49.83, 18.51],
  [49.83, 15.69],
  [46, 15.69],
  [39.61, 5.82],
  [37.06, 4.41],
  [31.94, 3],
  [21.72, 7.23],
  [14.06, 17.1],
  [14.06, 18.51],
  [19.17, 24.15],
  [17.89, 25.56],
  [15.33, 21.33],
  [12.78, 21.33],
  [7.67, 24.15],
  [0, 26.97],
  [8.94, 32.61],
  [12.78, 34.02],
  [15.33, 38.25],
  [15.33, 42.48],
  [12.78, 43.89],
  [6.39, 45.3],
  [5.11, 48.11],
  [5.11, 56.57],
  [7.67, 57.98],
  [7.67, 63.62],
  [16.61, 66.44],
  [20.44, 72.08],
  [17.89, 76.31],
  [19.17, 81.95],
  [24.28, 89],
  [29.39, 87.59],
  [39.61, 80.54],
  [38.33, 76.31],
  [42.17, 72.08],
  [60.06, 63.62],
  [65.17, 57.98],
  [70.28, 53.75],
  [71.56, 49.52],
  [76.67, 48.11],
  [81.78, 45.3],
  [85.61, 43.89],
  [86.89, 45.3],
];

/** 基隆市 — the harbour city wedged into New Taipei's north-east coast. */
const KEELUNG_CITY: readonly (readonly [number, number])[] = [
  [43.44, 24.15],
  [51.11, 19.92],
  [52.39, 21.33],
  [60.06, 24.15],
  [60.06, 31.2],
  [61.33, 32.61],
  [60.06, 35.43],
  [56.22, 35.43],
  [47.28, 31.2],
];

/** 臺北市 — the basin, completely enclosed by New Taipei. */
const TAIPEI_CITY: readonly (readonly [number, number])[] = [
  [42.17, 46.7],
  [34.5, 48.11],
  [28.11, 41.07],
  [26.83, 38.25],
  [26.83, 31.2],
  [21.72, 26.97],
  [26.83, 19.92],
  [33.22, 15.69],
  [34.5, 14.28],
  [38.33, 17.1],
  [38.33, 19.92],
  [40.89, 28.38],
  [43.44, 32.61],
  [42.17, 38.25],
  [47.28, 41.07],
];

/** 新北市 — its own undissolved outline: the region's coast plus the two enclave boundaries. */
const NEW_TAIPEI_CITY: readonly (readonly [number, number])[] = [
  [92, 43.89],
  [86.89, 45.3],
  [85.61, 43.89],
  [81.78, 45.3],
  [76.67, 48.11],
  [71.56, 49.52],
  [70.28, 53.75],
  [65.17, 57.98],
  [60.06, 63.62],
  [42.17, 72.08],
  [38.33, 76.31],
  [39.61, 80.54],
  [29.39, 87.59],
  [24.28, 89],
  [19.17, 81.95],
  [17.89, 76.31],
  [20.44, 72.08],
  [16.61, 66.44],
  [7.67, 63.62],
  [7.67, 57.98],
  [5.11, 56.57],
  [5.11, 48.11],
  [6.39, 45.3],
  [12.78, 43.89],
  [15.33, 42.48],
  [15.33, 38.25],
  [12.78, 34.02],
  [8.94, 32.61],
  [0, 26.97],
  [7.67, 24.15],
  [12.78, 21.33],
  [15.33, 21.33],
  [17.89, 25.56],
  [19.17, 24.15],
  [14.06, 18.51],
  [14.06, 17.1],
  [21.72, 7.23],
  [31.94, 3],
  [37.06, 4.41],
  [39.61, 5.82],
  [46, 15.69],
  [49.83, 15.69],
  [49.83, 18.51],
  [51.11, 19.92],
  [43.44, 24.15],
  [49.83, 32.61],
  [58.78, 35.43],
  [61.33, 34.02],
  [60.06, 29.79],
  [60.06, 24.15],
  [79.22, 28.38],
  [77.94, 34.02],
  [80.5, 41.07],
  [86.89, 41.07],
];

/**
 * Presentation cartography for the Greater Taipei board. Unlike Taiwan (whose silhouette is
 * hand-drawn by the web layer's `Geography` component), this map ships its geography as content,
 * so every surface — the live board, the ticket mini-maps, the map builder after a fork, and the
 * server's social card — draws the same region from this one definition.
 */
export const TAIPEI_GEOGRAPHY: MapGeography = {
  baseView: { ...TAIPEI_BASE_VIEW },
  land: [TAIPEI_REGION.map(([x, y]) => [x, y] as [number, number])],
  borders: [TAIPEI_CITY, NEW_TAIPEI_CITY, KEELUNG_CITY].map((ring) =>
    ring.map(([x, y]) => [x, y] as [number, number]),
  ),
  crop: { lonMin: 121.29, lonMax: 122.01, latMin: 24.68, latMax: 25.29 },
};
