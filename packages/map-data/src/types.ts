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
  /** Custom-map cartography; absent for maps that render via hand-authored geography (Taiwan). */
  readonly geography?: MapGeography;
  /** Custom-map rule defaults; absent means the engine's DEFAULT_RULE_PARAMS apply. */
  readonly rules?: MapRules;
}

export const isFerry = (r: RouteDef): boolean => r.ferryLocos > 0;
