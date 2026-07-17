import type { CityId, RouteId, TicketId, RouteColor, RouteLength, RuleParams } from '@trm/shared';

export type CityTier = 'major' | 'secondary' | 'tertiary' | 'minor';

export interface CityDef {
  readonly id: CityId;
  readonly nameZh: string;
  readonly nameEn: string;
  /** Relative map position: x 0 (west) … 100 (east), y 0 (north) … 100 (south). */
  readonly x: number;
  readonly y: number;
  readonly region: string;
  readonly isIsland: boolean;
  /** Cartographic label tier driving the live board's progressive zoom reveal (see the web
   *  layer's game/content.ts `cityTier` + game/lod.ts `zoomBucket`). Optional so pre-existing
   *  authored content and test fixtures that predate this field keep hashing identically
   *  (`stableStringify` drops absent keys) — absent reads as `'minor'` everywhere it's consumed. */
  readonly tier?: CityTier;
}

export interface RouteDef {
  readonly id: RouteId;
  readonly a: CityId;
  readonly b: CityId;
  readonly color: RouteColor;
  readonly length: RouteLength;
  /** 'A'..'J' if this route is one edge of a double-route pair, else undefined. */
  readonly doubleGroup?: string;
  /** >0 ⇒ ferry: this many LOCOMOTIVE symbols required (gray routes only). */
  readonly ferryLocos: number;
  readonly isTunnel: boolean;
  /**
   * >0 ⇒ broken rail (斷軌): the route cannot be claimed until a player spends a turn repairing
   * it — paying this many cards of the route's colour (gray: any one colour; locomotives wild)
   * and scoring as if they had built a route of this length. Must be a valid route length
   * (1,2,3,4,6,8) and ≤ `length`. Optional so pre-existing content hashes identically
   * (`stableStringify` drops absent keys); absent reads as 0 (a normal route).
   */
  readonly brokenCarriages?: number;
  /**
   * Signed curve-apex deviation from the straight chord (board units, along the chord's unit
   * normal (-dy, dx)/len for a→b). Absent ⇒ the automatic bow (arc away from intruding cities).
   * Authored by the map builder's Curves stage; render-only — the engine ignores it.
   */
  readonly bow?: number;
}

/**
 * Presentation-only "displayed area" for a mission ticket's mini-map (ignored by the engine).
 *  - `full`  → the whole map (baseView).
 *  - `auto`  → auto-crop: the bounding box of the ticket's two cities, padded; always contains both.
 *  - `zoom`  → auto-frame centered on the midpoint of the two cities; `level` 0 (whole map) … 1 (tight).
 */
export type TicketView =
  | { readonly mode: 'full' }
  | { readonly mode: 'auto' }
  | { readonly mode: 'zoom'; readonly level: number };

export interface TicketDef {
  readonly id: TicketId;
  readonly a: CityId;
  readonly b: CityId;
  readonly value: number;
  readonly deck: 'LONG' | 'SHORT';
  /** Per-ticket displayed-area override; absent ⇒ inherit the map default (see MapGeography). */
  readonly view?: TicketView;
}

/** An authored city pair eligible for the Lucky Ticket Stub random event. */
export interface AuspiciousPair {
  readonly id: string;
  readonly a: CityId;
  readonly b: CityId;
}

export interface MapMeta {
  readonly mapId: string;
  readonly version: number;
  readonly nameZh: string;
  readonly nameEn: string;
}

/** Presentation-only cartography for a custom map's crop of the world. Ignored by the engine. */
export interface MapGeography {
  readonly baseView: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
  /** Land rings in 0-100 board space, coordinates rounded to 2 decimals before hashing/storage. */
  readonly land: readonly (readonly (readonly [number, number])[])[];
  /** Crop provenance (lon/lat bbox) — supports re-editing and graticule rendering. */
  readonly crop: {
    readonly lonMin: number;
    readonly lonMax: number;
    readonly latMin: number;
    readonly latMax: number;
  };
  /** Map-wide default displayed area for tickets that set no `view` of their own. */
  readonly defaultTicketView?: TicketView;
  /** Optional cosmetic country-border overlay: each picked country's own (undissolved) exterior
   *  ring, in the same board-space/rounding convention as `land`. Drawn as unfilled strokes on top
   *  of `land` — where two selected countries share an edge, both rings trace it and it reads as a
   *  single border line; a coastal edge simply retraces the coastline. Absent ⇒ no overlay. Only
   *  ever populated by the "pick whole countries" crop mode (a manual crop box has no per-country
   *  data to draw borders from). */
  readonly borders?: readonly (readonly (readonly [number, number])[])[];
}

/** The curated subset of RuleParams a map may set as its own defaults (ignored by the engine
 *  itself — GameConfig.ruleParams is what the engine actually reads at initGame). */
export const MAP_RULE_KEYS = [
  'trainCarsStart',
  'stationsPerPlayer',
  'longestPathBonus',
  'stationBonus',
  'initialLongOffer',
  'initialShortOffer',
  'ticketDrawCount',
] as const;
export type MapRules = Partial<Pick<RuleParams, (typeof MAP_RULE_KEYS)[number]>>;

export interface GameContent {
  readonly meta: MapMeta;
  readonly cities: readonly CityDef[];
  readonly routes: readonly RouteDef[];
  readonly tickets: readonly TicketDef[];
  /** Optional authored targets for Lucky Ticket Stub. Absent keeps pre-v5 content hashes stable. */
  readonly auspiciousPairs?: readonly AuspiciousPair[];
  /** Custom-map cartography; absent for maps that render via hand-authored geography (Taiwan). */
  readonly geography?: MapGeography;
  /** Custom-map rule defaults; absent means the engine's DEFAULT_RULE_PARAMS apply. */
  readonly rules?: MapRules;
}

export const isFerry = (r: RouteDef): boolean => r.ferryLocos > 0;
