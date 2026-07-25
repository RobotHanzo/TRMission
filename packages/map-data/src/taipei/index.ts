// The Greater Taipei official map (issue #37): the metro network of Taipei, New Taipei, Keelung
// and the airport corridor as a Ticket to Ride-style board. Original cartography and an original
// station graph — the only thing reused from the real network is which places it connects.
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
  { id: 'tp-taipeimain-airport', a: asCityId('tp_taipeimain'), b: asCityId('tp_airport') },
  { id: 'tp-tamsui-xindian', a: asCityId('tp_tamsui'), b: asCityId('tp_xindian') },
];

/**
 * The board is denser and its segments far shorter than Taiwan's (83 routes totalling 158 cars,
 * against Taiwan's 77 totalling 217), so the train supply comes down with it: 32 cars keeps five
 * players just short of saturating the network, the same tension the bundled map has at 45.
 * Everything else stays on the engine defaults.
 */
export const TAIPEI_RULES: MapRules = {
  trainCarsStart: 32,
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
