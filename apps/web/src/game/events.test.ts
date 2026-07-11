import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { EVENT_KINDS, eventRejectionHintKey } from './events';

const BONUS_REASONS = [
  'HOTSPOT',
  'REOPEN',
  'STAMP',
  'CHARTER',
  'FREE_STATION',
  'LANTERN',
  'BENTO_COLLECT',
  'BENTO_POINTS',
  'REPAIR',
  'BLESSING',
  'PROCESSION',
  'INTERIM_TRAIL',
  'INTERIM_ROUTES',
  'HARVEST',
  'RESERVED_LOCO',
  'LUCKY',
] as const;

const EVENT_REJECTION_KEYS = [
  'errors:routeClosedByEvent',
  'errors:eventClaimsSuspended',
  'errors:eventStationsSuspended',
  'errors:eventFaceupLocoBlocked',
  'errors:eventRepairUnavailable',
  'errors:eventRepairPaymentInvalid',
  'errors:eventNightMarketUnavailable',
  'errors:eventLanternRelocationInvalid',
  'errors:eventDraftChoiceInvalid',
  'errors:eventHiveUnavailable',
  'errors:eventResourceUnavailable',
] as const;

describe('random-event localization coverage', () => {
  it('has names and descriptions for every wire event kind in both locales', () => {
    for (const lng of ['zh-Hant', 'en'] as const) {
      for (const kind of EVENT_KINDS) {
        expect(i18n.exists(`events.${kind}.name`, { lng })).toBe(true);
        expect(i18n.exists(`events.${kind}.desc`, { lng })).toBe(true);
      }
    }
  });

  it('has exact log keys for every authoritative bonus and recycle reason', () => {
    for (const lng of ['zh-Hant', 'en'] as const) {
      for (const reason of BONUS_REASONS)
        expect(i18n.exists(`log.eventBonus.${reason}`, { lng })).toBe(true);
      for (const reason of ['THREE_LOCOS', 'THREE_OF_COLOR'])
        expect(i18n.exists(`log.marketRecycled.${reason}`, { lng })).toBe(true);
    }
  });

  it('resolves every event rejection message key to translated copy', () => {
    for (const messageKey of EVENT_REJECTION_KEYS) {
      const translatedKey = eventRejectionHintKey(messageKey);
      expect(translatedKey).not.toBeNull();
      expect(i18n.exists(translatedKey!, { lng: 'zh-Hant' })).toBe(true);
      expect(i18n.exists(translatedKey!, { lng: 'en' })).toBe(true);
    }
  });
});
