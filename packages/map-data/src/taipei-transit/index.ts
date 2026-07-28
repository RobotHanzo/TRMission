// 大臺北軌道交通 — the third official map, adopted from community author 嶼翼's builder draft
// (map.json revision 847). Unlike the two TRMission-authored maps, this content is 嶼翼's design:
// stops, network, missions and rules are kept verbatim; adoption only renamed ids to the
// tt_/TTR/TTL/TTS scheme (so any id in a log or replay names exactly one map), normalised the
// regions to real administrative divisions, trimmed the excess Taoyuan/Yilan county area out of
// the cartography, and added the 陽明山 + 雪山山脈 relief (see geography.ts). The author is
// credited via `meta.author` everywhere official maps are listed.
//
// Assembled here and hashed by the package index (which owns `hashContent`), so this module has
// no dependency on the registry that registers it.
import { asCityId } from '@trm/shared';
import type { AuspiciousPair, GameContent, MapMeta, MapRules } from '../types';
import { TAIPEI_TRANSIT_CITIES } from './cities';
import { TAIPEI_TRANSIT_ROUTES } from './routes';
import { TAIPEI_TRANSIT_TICKETS } from './tickets';
import { TAIPEI_TRANSIT_GEOGRAPHY } from './geography';

export * from './cities';
export * from './routes';
export * from './tickets';
export * from './geography';

export const TAIPEI_TRANSIT_META: MapMeta = {
  mapId: 'taipei-transit',
  version: 1,
  nameZh: '大臺北軌道交通',
  nameEn: 'Greater Taipei Rail Transit Map',
  author: '嶼翼',
};

export const TAIPEI_TRANSIT_AUSPICIOUS_PAIRS: readonly AuspiciousPair[] = [
  // The basin to the Yilan side — through the 雪山山脈 wall the relief layer draws.
  { id: 'tt-taipei-jiaoxi', a: asCityId('tt_taipei'), b: asCityId('tt_jiaoxi') },
  // Estuary to the north-east cape, the whole coast road.
  { id: 'tt-tamsui-fulong', a: asCityId('tt_tamsui'), b: asCityId('tt_fulong') },
];

/**
 * The author's rule sheet, kept as authored: a heavier 55-car supply on a 239-car network (the
 * bundled Taiwan map's ratio at 45 cars is similar), a 4-mission initial short offer and 5-card
 * mission draws. Only the deltas from the engine defaults are carried.
 */
export const TAIPEI_TRANSIT_RULES: MapRules = {
  trainCarsStart: 55,
  initialShortOffer: 4,
  ticketDrawCount: 5,
};

export const TAIPEI_TRANSIT_CONTENT: GameContent = {
  meta: TAIPEI_TRANSIT_META,
  cities: TAIPEI_TRANSIT_CITIES,
  routes: TAIPEI_TRANSIT_ROUTES,
  tickets: TAIPEI_TRANSIT_TICKETS,
  auspiciousPairs: TAIPEI_TRANSIT_AUSPICIOUS_PAIRS,
  geography: TAIPEI_TRANSIT_GEOGRAPHY,
  rules: TAIPEI_TRANSIT_RULES,
};
