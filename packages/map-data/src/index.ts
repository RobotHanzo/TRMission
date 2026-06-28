import { digest } from '@trm/shared';
import type { GameContent, MapMeta } from './types';
import { CITIES } from './cities';
import { ROUTES } from './routes';
import { TICKETS } from './tickets';
import { CONTENT_V2 } from './archive/v2';

export * from './types';
export * from './cities';
export * from './routes';
export * from './tickets';
export * from './validate';

export const MAP_META: MapMeta = {
  mapId: 'taiwan',
  version: 3,
  nameZh: '台灣本島與離島',
  nameEn: 'Taiwan & Outlying Islands',
};

/** The canonical authored content — the single source of truth (ADR A13). */
export const TAIWAN_CONTENT: GameContent = {
  meta: MAP_META,
  cities: CITIES,
  routes: ROUTES,
  tickets: TICKETS,
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
  [CONTENT_V2, TAIWAN_CONTENT].map((c) => [hashContent(c), c] as const),
);

/** Resolve the exact content a game was created against, or undefined if its version is unknown. */
export function resolveContentByHash(hash: string): GameContent | undefined {
  return CONTENT_REGISTRY.get(hash);
}
