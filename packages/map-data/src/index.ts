import { digest } from '@trm/shared';
import type { GameContent, MapMeta } from './types';
import { CITIES } from './cities';
import { ROUTES } from './routes';
import { TICKETS } from './tickets';

export * from './types';
export * from './cities';
export * from './routes';
export * from './tickets';
export * from './validate';

export const MAP_META: MapMeta = {
  mapId: 'taiwan',
  version: 1,
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
 * Content hash pins a game/replay to exact authored content (ADR A6/A13). Derived from the
 * canonical content via the shared deterministic digest, so any change to a city, route,
 * ticket, or map version produces a new hash.
 */
export const CONTENT_HASH: string = digest({
  meta: TAIWAN_CONTENT.meta,
  cities: TAIWAN_CONTENT.cities,
  routes: TAIWAN_CONTENT.routes,
  tickets: TAIWAN_CONTENT.tickets,
});
