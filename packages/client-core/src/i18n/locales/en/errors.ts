import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/errors';

export default {
  routeClosedByEvent: 'This route is closed by the typhoon',
  eventClaimsSuspended: 'Typhoon day off: no route claims this round',
  eventStationsSuspended: 'Typhoon day off: no stations this round',
  eventFaceupLocoBlocked: 'Face-up locomotives cannot be taken during All Seats Reserved',
  eventRepairUnavailable: 'That route cannot be repaired now',
  eventRepairPaymentInvalid: 'A repair needs two matching cards or a repair permit',
  eventNightMarketUnavailable: 'The night market is not available now',
  eventLanternRelocationInvalid: 'That city cannot become the new lantern host',
  eventDraftChoiceInvalid: 'That allocation perk cannot be chosen now',
  eventHiveUnavailable: 'The Hive of Sparks draw is not available now',
  eventResourceUnavailable: 'No matching event resource is available',
  lanternRelocationRequired: 'Move the lantern host marker first',
  invalidLanternHostCity: 'That city cannot become the new lantern host',
  noBentoToken: 'You have no bento to spend',
  invalidBentoSpend: 'That bento option is not legal for this claim',
  routeNotRepairable: 'That route cannot be repaired now',
  invalidRepairPayment: 'A repair needs two matching cards or a repair permit',
  routeBroken: 'That rail is broken — it must be repaired before it can be claimed',
  routeRepairExclusive: 'The repairer has first claim rights this round',
  nightMarketUnavailable: 'The night market is not available now',
  invalidNightMarketSwap: 'Those train cards cannot be swapped',
  invalidEventPerk: 'That allocation perk cannot be chosen',
  hiveDrawUnavailable: 'The Hive of Sparks draw is not available now',
  faceupLocomotiveReserved: 'Face-up locomotives cannot be taken during All Seats Reserved',
} satisfies TranslationShape<typeof zh>;
