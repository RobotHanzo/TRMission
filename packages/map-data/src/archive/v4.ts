import type { GameContent, MapMeta } from '../types';
import { CITIES } from '../cities';
import { ROUTES } from '../routes';
import { TICKETS } from '../tickets';

/** Frozen map-content version 4, immediately before authored auspicious pairs were added in v5. */
const V4_META: MapMeta = {
  mapId: 'taiwan',
  version: 4,
  nameZh: '台灣本島與離島',
  nameEn: 'Taiwan & Outlying Islands',
};

export const CONTENT_V4: GameContent = {
  meta: V4_META,
  cities: CITIES,
  routes: ROUTES,
  tickets: TICKETS,
};
