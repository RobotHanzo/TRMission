import { asCityId, digest } from '@trm/shared';
import type { GameContent, MapMeta, MapGeography, AuspiciousPair } from './types';
import { CITIES } from './cities';
import { ROUTES } from './routes';
import { TICKETS } from './tickets';
import { taiwanForkGeography } from './taiwan-geography';
import { CONTENT_V2 } from './archive/v2';
import { CONTENT_V3 } from './archive/v3';
import { CONTENT_V4 } from './archive/v4';

export * from './types';
export * from './cities';
export * from './routes';
export * from './tickets';
export * from './validate';
export * from './graph';
export * from './generate';
export * from './geometry';
export * from './ticket-view';
export * from './taiwan-geography';
export * from './render-tokens';

export const MAP_META: MapMeta = {
  mapId: 'taiwan',
  version: 5,
  nameZh: '台灣本島與離島',
  nameEn: 'Taiwan & Outlying Islands',
};

export const AUSPICIOUS_PAIRS: readonly AuspiciousPair[] = [
  { id: 'taipei-kaohsiung', a: asCityId('taipei'), b: asCityId('kaohsiung') },
  { id: 'hualien-taitung', a: asCityId('hualien'), b: asCityId('taitung') },
];

/** The canonical authored content — the single source of truth (ADR A13). */
export const TAIWAN_CONTENT: GameContent = {
  meta: MAP_META,
  cities: CITIES,
  routes: ROUTES,
  tickets: TICKETS,
  auspiciousPairs: AUSPICIOUS_PAIRS,
};

/**
 * The deterministic content hash that pins a game/replay to exact authored content
 * (ADR A6/A13). Any change to a city, route, ticket, or `meta.version` produces a new hash.
 * This is the single hashing formula; every registered version is keyed by it.
 */
export function hashContent(content: GameContent): string {
  return digest({
    meta: content.meta,
    cities: content.cities,
    routes: content.routes,
    tickets: content.tickets,
    // Spread-if-defined: content minted before geography/rules existed must keep hashing
    // identically (packages/map-data/test/versions.spec.ts pins this byte-for-byte).
    ...(content.geography !== undefined ? { geography: content.geography } : {}),
    ...(content.rules !== undefined ? { rules: content.rules } : {}),
    ...(content.auspiciousPairs !== undefined ? { auspiciousPairs: content.auspiciousPairs } : {}),
  });
}

/** Hash of the current canonical content. New games are stamped with this. */
export const CONTENT_HASH: string = hashContent(TAIWAN_CONTENT);

/**
 * Every published content version, current and archived, keyed by its content hash. Content
 * is immutable once published: editing the map ships a *new* version (bump `meta.version`)
 * and keeps the prior one here, so a persisted game can always rebuild the exact board it was
 * created against. Recovery resolves a game's stored `contentHash` through this map — a
 * content change therefore never breaks an in-flight game's replay.
 */
export const CONTENT_REGISTRY: ReadonlyMap<string, GameContent> = new Map(
  [CONTENT_V2, CONTENT_V3, CONTENT_V4, TAIWAN_CONTENT].map((c) => [hashContent(c), c] as const),
);

/** Resolve the exact content a game was created against, or undefined if its version is unknown. */
export function resolveContentByHash(hash: string): GameContent | undefined {
  return CONTENT_REGISTRY.get(hash);
}

export interface OfficialMap {
  readonly mapId: string;
  readonly content: GameContent;
  readonly hash: string;
  /** Geography to seed a fork with when the content carries none (Taiwan's built-in silhouette
   *  is not a MapGeography). Absent for world-cropped official maps — use content.geography. */
  readonly forkGeography?: MapGeography;
}

/** Every map shipped by TRMission itself (as opposed to a user-authored custom map). */
export const OFFICIAL_MAPS: readonly OfficialMap[] = [
  {
    mapId: MAP_META.mapId,
    content: TAIWAN_CONTENT,
    hash: CONTENT_HASH,
    forkGeography: taiwanForkGeography(),
  },
];

export function officialMapById(mapId: string): OfficialMap | undefined {
  return OFFICIAL_MAPS.find((m) => m.mapId === mapId);
}
