import { describe, expect, it } from 'vitest';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { RandomEventsStateSchema, RandomEventInfoSchema } from '@trm/proto';
import i18n from '../i18n';
import {
  EVENT_KINDS,
  eventRejectionHintKey,
  eventNameKey,
  skyLanternRouteIds,
  skyLanternSurcharge,
  freeStationAvailable,
  closedRouteIds,
  reopenBonusRouteIds,
  hotspotLevels,
  roundsLeft,
  isCharterOpen,
  hasActiveEvent,
  boardEventOverlays,
} from './events';

const state = (over: MessageInitShape<typeof RandomEventsStateSchema>) =>
  create(RandomEventsStateSchema, { mode: 'intense', roundIndex: 3, ...over });
const info = (over: MessageInitShape<typeof RandomEventInfoSchema>) =>
  create(RandomEventInfoSchema, over);

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

describe('boardEventOverlays (the one board-overlay projection, shared web+mobile)', () => {
  it('is all-empty for undefined (events-off games, sandboxes)', () => {
    const o = boardEventOverlays(undefined);
    expect(o.closedRoutes.size).toBe(0);
    expect(o.hotspots.size).toBe(0);
    expect(o.luckyLinks).toEqual([]);
    expect(o.lanternCity).toBeNull();
    expect(o.processionCity).toBeNull();
  });

  it('derives every overlay slice in one pass', () => {
    const o = boardEventOverlays(
      state({
        closedRouteIds: ['C1'],
        reopenBonusRouteIds: ['B1'],
        hotspots: [{ cityId: 'tpe', level: 2 }],
        charters: [
          { id: 'ch1', cityA: 'tpe', cityB: 'khh', points: 8, wonByPlayerId: '' },
          { id: 'ch2', cityA: 'txg', cityB: 'tnn', points: 6, wonByPlayerId: 'p1' }, // won → hidden
        ],
        luckyContracts: [
          { eventId: 'l1', cityA: 'hsz', cityB: 'ttt', points: 4, wonByPlayerId: '' },
          { eventId: 'l2', cityA: 'kee', cityB: 'cyi', points: 4, wonByPlayerId: 'p2' },
        ],
        lanternHost: { cityId: 'ila' },
        active: [
          { id: 's', kind: 'SKY_LANTERN', routeIds: ['S1'] },
          { id: 'h', kind: 'HARVEST_FESTIVAL_EXPRESS', routeIds: ['H1', 'H2'] },
          { id: 'g', kind: 'GODDESS_PROCESSION', cityPath: ['a', 'b', 'c'], position: 7 },
          { id: 'bn', kind: 'BENTO_RUSH', cityId: 'bento-city' },
          { id: 'nm', kind: 'STATION_FRONT_NIGHT_MARKET', cityId: 'night-city' },
        ],
      }),
    );
    expect([...o.closedRoutes]).toEqual(['C1']);
    expect([...o.reopenRoutes]).toEqual(['B1']);
    expect([...o.skyRoutes]).toEqual(['S1']);
    expect([...o.harvestRoutes].sort()).toEqual(['H1', 'H2']);
    expect(o.hotspots.get('tpe')).toBe(2);
    expect([...o.charterCities].sort()).toEqual(['khh', 'tpe']);
    expect(o.charterPairs.get('khh')).toEqual({ a: 'tpe', b: 'khh', pts: 8 });
    expect([...o.luckyCities].sort()).toEqual(['hsz', 'ttt']);
    expect(o.luckyPairs.get('ttt')).toEqual({ a: 'hsz', b: 'ttt' });
    expect(o.luckyLinks).toEqual([{ id: 'l1', a: 'hsz', b: 'ttt' }]);
    expect(o.lanternCity).toBe('ila');
    expect(o.processionPath).toEqual(['a', 'b', 'c']);
    // position past the path tail clamps to the last stop.
    expect(o.processionCity).toBe('c');
    expect([...o.bentoCities]).toEqual(['bento-city']);
    expect([...o.nightMarketCities]).toEqual(['night-city']);
  });
});

describe('random-events derivations', () => {
  it('sky-lantern surcharge is +1 only for a route listed by an active SKY_LANTERN', () => {
    const ev = state({
      active: [{ id: 'e1', kind: 'SKY_LANTERN', routeIds: ['R1', 'R2'], endsAfterRound: 5 }],
    });
    expect(skyLanternSurcharge(ev, 'R1')).toBe(1);
    expect(skyLanternSurcharge(ev, 'R2')).toBe(1);
    expect(skyLanternSurcharge(ev, 'R9')).toBe(0);
    expect(skyLanternSurcharge(undefined, 'R1')).toBe(0);
  });

  it('ignores non-sky-lantern active entries when pricing the surcharge', () => {
    const ev = state({ active: [{ id: 't', kind: 'TYPHOON_LANDFALL', routeIds: ['R1'] }] });
    expect(skyLanternRouteIds(ev).has('R1')).toBe(false);
    expect(skyLanternSurcharge(ev, 'R1')).toBe(0);
  });

  it('free-station availability mirrors the wire flag', () => {
    expect(freeStationAvailable(state({ freeStationAvailable: true }))).toBe(true);
    expect(freeStationAvailable(state({}))).toBe(false);
    expect(freeStationAvailable(undefined)).toBe(false);
  });

  it('exposes closed and reopen-bonus route sets', () => {
    const ev = state({ closedRouteIds: ['C1', 'C2'], reopenBonusRouteIds: ['B1'] });
    expect([...closedRouteIds(ev)].sort()).toEqual(['C1', 'C2']);
    expect([...reopenBonusRouteIds(ev)]).toEqual(['B1']);
    expect(closedRouteIds(undefined).size).toBe(0);
  });

  it('maps hotspot levels by city id', () => {
    const ev = state({
      hotspots: [
        { cityId: 'taipei', level: 2 },
        { cityId: 'hualien', level: 1 },
      ],
    });
    expect(hotspotLevels(ev).get('taipei')).toBe(2);
    expect(hotspotLevels(ev).get('hualien')).toBe(1);
    expect(hotspotLevels(ev).get('nope')).toBeUndefined();
  });

  it('computes rounds-left as ends_after_round − round_index + 1, null for instants', () => {
    expect(roundsLeft(info({ endsAfterRound: 5 }), 3)).toBe(3);
    expect(roundsLeft(info({ endsAfterRound: 3 }), 3)).toBe(1);
    expect(roundsLeft(info({ endsAfterRound: 0 }), 3)).toBeNull();
  });

  it('treats a charter with no winner as open', () => {
    expect(isCharterOpen({ wonByPlayerId: '' })).toBe(true);
    expect(isCharterOpen({ wonByPlayerId: 'p2' })).toBe(false);
  });

  it('detects an active event by kind, tolerating an absent block', () => {
    const ev = state({ active: [{ id: 'a', kind: 'ALL_SEATS_RESERVED' }] });
    expect(hasActiveEvent(ev, 'ALL_SEATS_RESERVED')).toBe(true);
    expect(hasActiveEvent(ev, 'HIVE_OF_SPARKS')).toBe(false);
    expect(hasActiveEvent(undefined, 'ALL_SEATS_RESERVED')).toBe(false);
  });

  it('resolves known kind name keys, passing through unknown kinds', () => {
    expect(eventNameKey('SKY_LANTERN')).toBe('events.SKY_LANTERN.name');
    expect(eventNameKey('MYSTERY')).toBe('MYSTERY');
  });
});

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
