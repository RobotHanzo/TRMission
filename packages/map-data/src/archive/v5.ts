import { asCityId } from '@trm/shared';
import type { GameContent, MapMeta, AuspiciousPair } from '../types';
import { TICKETS } from '../tickets';
import { V4_CITIES, V4_ROUTES } from './v4';

/**
 * Frozen map-content version 5 — the tw2.1 network plus authored auspicious pairs, as it stood
 * just before the 2026-07-19 route changelog (花蓮–綠島 → 玉里–綠島, 南投–阿里山 replaced by
 * 阿里山–池上, and 16 route-car length/colour rewrites) shipped as v6. Persisted/in-flight games
 * created against v5 carry its `contentHash`; the registry rebuilds their exact board from this
 * snapshot, so the v6 content change never breaks their recovery/replay (ADR A6/A13).
 *
 * `tickets` is untouched so far, so it's referenced from the live table (byte-identical);
 * `cities` and `routes` didn't change between v4 and v5 either (only `meta`/`auspiciousPairs`
 * did), so both are referenced from the frozen `V4_CITIES`/`V4_ROUTES` rather than duplicating
 * their tables. The pinned v5 hash assertion in `test/versions.spec.ts` is the tripwire that
 * this copy stayed byte-exact.
 */

const V5_META: MapMeta = {
  mapId: 'taiwan',
  version: 5,
  nameZh: '台灣本島與離島',
  nameEn: 'Taiwan & Outlying Islands',
};

const V5_AUSPICIOUS_PAIRS: readonly AuspiciousPair[] = [
  { id: 'taipei-kaohsiung', a: asCityId('taipei'), b: asCityId('kaohsiung') },
  { id: 'hualien-taitung', a: asCityId('hualien'), b: asCityId('taitung') },
];

export const CONTENT_V5: GameContent = {
  meta: V5_META,
  cities: V4_CITIES,
  routes: V4_ROUTES,
  tickets: TICKETS,
  auspiciousPairs: V5_AUSPICIOUS_PAIRS,
};
