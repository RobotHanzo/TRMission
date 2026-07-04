import { describe, it, expect } from 'vitest';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { RandomEventsStateSchema, RandomEventInfoSchema } from '@trm/proto';
import {
  skyLanternRouteIds,
  skyLanternSurcharge,
  freeStationAvailable,
  closedRouteIds,
  reopenBonusRouteIds,
  hotspotLevels,
  roundsLeft,
  isCharterOpen,
  eventNameKey,
} from './events';

const state = (over: MessageInitShape<typeof RandomEventsStateSchema>) =>
  create(RandomEventsStateSchema, { mode: 'intense', roundIndex: 3, ...over });
const info = (over: MessageInitShape<typeof RandomEventInfoSchema>) =>
  create(RandomEventInfoSchema, over);

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

  it('resolves known kind name keys, passing through unknown kinds', () => {
    expect(eventNameKey('SKY_LANTERN')).toBe('events.SKY_LANTERN.name');
    expect(eventNameKey('MYSTERY')).toBe('MYSTERY');
  });
});
