// The Greater Taipei official map (issue #37): 臺北市 + 新北市 + 基隆市 as a Ticket to Ride-style
// board — the metro in the basin, and the district towns, coast road and mountain roads that make
// up the rest of the region. The land and city boundaries are generated from public-domain
// admin-1 data and the stops are projected through the same projection, so the board is the real
// region; the route network on top of it is this map's own authored graph.
//
// Assembled here and hashed by the package index (which owns `hashContent`), so this module has
// no dependency on the registry that registers it.
import { asCityId } from '@trm/shared';
import type { AuspiciousPair, GameContent, MapMeta, MapRules } from '../types';
import { TAIPEI_CITIES } from './cities';
import { TAIPEI_ROUTES } from './routes';
import { TAIPEI_TICKETS } from './tickets';
import { TAIPEI_GEOGRAPHY } from './geography';

export * from './cities';
export * from './routes';
export * from './tickets';
export * from './geography';

export const TAIPEI_META: MapMeta = {
  mapId: 'taipei',
  version: 1,
  nameZh: '大臺北捷運網',
  nameEn: 'Greater Taipei Metro',
};

export const TAIPEI_AUSPICIOUS_PAIRS: readonly AuspiciousPair[] = [
  { id: 'tp-taipeimain-keelung', a: asCityId('tp_taipeimain'), b: asCityId('tp_keelung') },
  { id: 'tp-tamsui-wulai', a: asCityId('tp_tamsui'), b: asCityId('tp_wulai') },
];

/**
 * The board is denser and its segments far shorter than Taiwan's (72 routes totalling 150 cars,
 * against Taiwan's 77 totalling 217), so the train supply comes down with it: 31 cars keeps five
 * players just short of saturating the network — the same trains-to-track ratio the bundled map
 * has at 45. Everything else stays on the engine defaults.
 */
export const TAIPEI_RULES: MapRules = {
  trainCarsStart: 31,
};

export const TAIPEI_CONTENT: GameContent = {
  meta: TAIPEI_META,
  cities: TAIPEI_CITIES,
  routes: TAIPEI_ROUTES,
  tickets: TAIPEI_TICKETS,
  auspiciousPairs: TAIPEI_AUSPICIOUS_PAIRS,
  geography: TAIPEI_GEOGRAPHY,
  rules: TAIPEI_RULES,
};
