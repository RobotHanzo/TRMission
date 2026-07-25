import type { MapGeography } from '../types';

/** Home view: frames the whole network plus the northern coastline and a strip of sea. */
export const TAIPEI_BASE_VIEW = { x: -3, y: 1, w: 106, h: 77 };

/**
 * The one land ring: northern Taiwan's coast, drawn to fit this board's (deliberately distorted)
 * station layout rather than to a projection. Read west → east it is the Taoyuan shore below the
 * airport, the Linkou terrace, then the Tamsui estuary — a wedge of open water reaching inland
 * far enough that the two ferry crossings genuinely run over it, with Bali on the south-west
 * bank and Tamsui/Fisherman's Wharf on the north-east — and finally the north coast past Sanzhi,
 * Shimen, Jinshan and Yeliu into Keelung harbour. The ring closes well outside the base view, so
 * everything south and east of the coast simply reads as land. Original geometry — nothing
 * traced from an existing map.
 */
const TAIPEI_COAST: readonly (readonly [number, number])[] = [
  [-30, 62], // far south-west, off view
  [-14, 48],
  [-3, 36],
  [3, 25], // the Taoyuan shore, north-west of the airport
  [8, 17],
  [13, 14], // the west side of the river mouth
  [19, 17], // …and inland along the Bali bank
  [25, 21],
  [28, 22], // head of the estuary, below Guandu
  [29, 17], // back out along the Tamsui bank
  [24, 11],
  [19, 6], // the east side of the river mouth
  [28, 5], // Sanzhi
  [36, 6],
  [48, 4], // Shimen — the northern cape
  [60, 6],
  [72, 8], // Jinshan
  [84, 11], // Yeliu
  [92, 14], // the approach to Keelung harbour
  [101, 12],
  [112, 22], // the north-east cape, off view
  [126, 40],
  [128, 96], // the ring closes far outside the base view
  [-34, 96],
];

/**
 * Presentation cartography for the Greater Taipei board. Unlike Taiwan (whose silhouette is
 * hand-drawn by the web layer's `Geography` component), this map ships its geography as content,
 * so every surface — the live board, the ticket mini-maps, the map builder after a fork, and the
 * server's social card — draws the same coast from this one definition.
 */
export const TAIPEI_GEOGRAPHY: MapGeography = {
  baseView: { ...TAIPEI_BASE_VIEW },
  land: [TAIPEI_COAST.map(([x, y]) => [x, y] as [number, number])],
  crop: { lonMin: 121.15, lonMax: 121.8, latMin: 24.9, latMax: 25.3 },
  // The network is dense and compact, so a ticket reads far better cropped to its two stops
  // than as the whole basin shrunk into a card.
  defaultTicketView: { mode: 'auto' },
};
