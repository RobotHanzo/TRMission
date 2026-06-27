import type { CityId, RouteId, TicketId, RouteColor, RouteLength } from '@trm/shared';

export interface CityDef {
  readonly id: CityId;
  readonly nameZh: string;
  readonly nameEn: string;
  /** Relative map position: x 0 (west) … 100 (east), y 0 (north) … 100 (south). */
  readonly x: number;
  readonly y: number;
  readonly region: string;
  readonly isIsland: boolean;
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
}

export interface TicketDef {
  readonly id: TicketId;
  readonly a: CityId;
  readonly b: CityId;
  readonly value: number;
  readonly deck: 'LONG' | 'SHORT';
}

export interface MapMeta {
  readonly mapId: string;
  readonly version: number;
  readonly nameZh: string;
  readonly nameEn: string;
}

export interface GameContent {
  readonly meta: MapMeta;
  readonly cities: readonly CityDef[];
  readonly routes: readonly RouteDef[];
  readonly tickets: readonly TicketDef[];
}

export const isFerry = (r: RouteDef): boolean => r.ferryLocos > 0;
