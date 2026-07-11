import { describe, it, expect } from 'vitest';
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import { initGame, redactFor, taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { GameConfig, GameEvent, GameState, EventsState } from '@trm/engine';
import { asPlayerId, asTicketId, asRouteId, asCityId } from '@trm/shared';
import {
  CardColor,
  Phase,
  ClientEnvelopeSchema,
  GameSnapshotSchema,
  GameEventSchema,
  RejectionCode,
} from '@trm/proto';
import { viewToSnapshot, eventToProto, commandToAction, rejectionToPb } from '../src';

const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');
const config: GameConfig = {
  seed: 'codec-pkg',
  players: [
    { id: p1, seat: 0 },
    { id: p2, seat: 1 },
  ],
  contentHash: CONTENT_HASH,
};

describe('@trm/codec viewToSnapshot', () => {
  it('keeps the viewer’s own offer and renders opponents as counts only', () => {
    const board = taiwanBoard();
    const state = initGame(board, config);
    const snap = viewToSnapshot(redactFor(board, state, p1), 0, p1);

    expect(snap.phase).toBe(Phase.SETUP_TICKETS);
    expect(snap.contentHash).toBe(CONTENT_HASH);
    expect(snap.turnOrder).toEqual(['p1', 'p2']);
    expect(snap.you?.playerId).toBe('p1');
    const opp = snap.players.find((p) => p.id === 'p2');
    expect(opp?.handCount).toBe(state.ruleParams.handStart);
    expect(opp).not.toHaveProperty('hand');
    expect(opp).not.toHaveProperty('keptTicketIds');
  });
});

describe('@trm/codec eventToProto', () => {
  it('blanks a blind-draw card for non-owners and drops private ticket offers', () => {
    const drawn: GameEvent = {
      e: 'CARD_DRAWN_BLIND',
      player: p1,
      card: 'RED',
      visibility: { private: p1 },
    };
    expect((eventToProto(drawn, p1)?.event.value as { card: number }).card).toBe(CardColor.RED);
    expect((eventToProto(drawn, p2)?.event.value as { card: number }).card).toBe(
      CardColor.UNSPECIFIED,
    );

    const offered: GameEvent = {
      e: 'TICKETS_OFFERED',
      player: p1,
      ticketIds: [asTicketId('S1')],
      visibility: { private: p1 },
    };
    expect(eventToProto(offered, p1)).not.toBeNull();
    expect(eventToProto(offered, p2)).toBeNull();
  });

  it('wraps TICKET_COMPLETED into a real frame (public — finished tickets are not hidden)', () => {
    const completed: GameEvent = {
      e: 'TICKET_COMPLETED',
      player: p1,
      ticket: asTicketId('S17'),
      visibility: 'PUBLIC',
    };
    const forOwner = eventToProto(completed, p1);
    const forOther = eventToProto(completed, p2);
    expect(forOwner?.event.case).toBe('ticketCompleted');
    expect(forOther?.event.case).toBe('ticketCompleted');
    if (forOwner?.event.case !== 'ticketCompleted') throw new Error('wrong case');
    expect(forOwner.event.value.playerId).toBe('p1');
    expect(forOwner.event.value.ticketId).toBe('S17');
  });
});

describe('@trm/codec commandToAction', () => {
  it('maps a claimRoute command onto the engine action bound to the player', () => {
    const env = create(ClientEnvelopeSchema, {
      clientSeq: 1,
      command: {
        case: 'claimRoute',
        value: {
          routeId: 'R50',
          payment: { color: CardColor.GREEN, colorCount: 6, locomotives: 2 },
        },
      },
    });
    expect(commandToAction(env.command, p1)).toEqual({
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('R50'),
      payment: { color: 'GREEN', colorCount: 6, locomotives: 2 },
    });
  });

  it('returns null for non-game frames (ping)', () => {
    const env = create(ClientEnvelopeSchema, { command: { case: 'ping', value: { nonce: 1 } } });
    expect(commandToAction(env.command, p1)).toBeNull();
  });
});

describe('@trm/codec viewToSnapshot — random events (M4)', () => {
  it('round-trips a full events block through wire bytes with every field intact', () => {
    const board = taiwanBoard();
    const state = initGame(board, config);
    const closedRoute = board.content.routes[0]!.id;
    const reopenRoute = board.content.routes[1]!.id;
    const forecastRoute = board.content.routes[2]!.id;
    const hotCity = board.cityIds[0]!;
    const charterA = board.cityIds[1]!;
    const charterB = board.cityIds[2]!;
    const wonA = board.cityIds[3]!;
    const wonB = board.cityIds[4]!;

    const events: EventsState = {
      mode: 'intense',
      roundIndex: 3,
      nextIdx: 0,
      schedule: [
        {
          id: 'evForecast',
          kind: 'SKY_LANTERN',
          startRound: 4,
          durationRounds: 2,
          telegraphed: true,
          routeIds: [forecastRoute],
          region: 'South',
        },
      ],
      suppressed: [],
      active: [
        {
          id: 'evTy',
          kind: 'TYPHOON_LANDFALL',
          endsAfterRound: 9,
          routeIds: [closedRoute],
          region: 'North',
        },
        {
          id: 'procession',
          kind: 'GODDESS_PROCESSION',
          endsAfterRound: 7,
          cityPath: [hotCity, charterA, charterB],
          position: 1,
        },
      ],
      hotspots: { [hotCity as string]: 2 },
      charters: [
        { id: 'evChOpen', a: charterA, b: charterB, points: 8, expiresAfterRound: 9, wonBy: null },
        { id: 'evChWon', a: wonA, b: wonB, points: 12, expiresAfterRound: 9, wonBy: p1 },
      ],
      luckyContracts: [{ id: 'lucky', a: charterA, b: wonB, points: 5, wonBy: null }],
      reopenBonus: [reopenRoute],
      repairedRouteIds: [forecastRoute],
      resources: {
        p1: { bentoTokens: 2, blessings: 3, claimDiscounts: 1, repairPermits: 1 },
      },
      freeStation: { untilRound: 3 },
      lanternHost: { eventId: 'lantern', cityId: hotCity, points: 6 },
      eventDraft: {
        eventId: 'draft',
        order: [p2, p1],
        pickIndex: 1,
        resumeOrderIndex: 0,
        picks: [{ playerId: p2, perk: 'DRAW_TWO' }],
      },
      boringMachine: { eventId: 'boring', remainingDraws: 12 },
    };
    const withEvents: GameState = {
      ...state,
      ruleParams: { ...state.ruleParams, eventsMode: 'intense' },
      events,
    };

    const view = redactFor(board, withEvents, p1);
    const snap = viewToSnapshot(view, 42, p1);
    const decoded = fromBinary(GameSnapshotSchema, toBinary(GameSnapshotSchema, snap));

    expect(decoded.gameSettings?.eventsMode).toBe('intense');
    const re = decoded.randomEvents;
    expect(re).toBeDefined();
    expect(re?.mode).toBe('intense');
    expect(re?.roundIndex).toBe(3);

    expect(re?.active.length).toBe(2);
    expect(re?.active[0]?.id).toBe('evTy');
    expect(re?.active[0]?.kind).toBe('TYPHOON_LANDFALL');
    expect(re?.active[0]?.endsAfterRound).toBe(9);
    expect(re?.active[0]?.routeIds).toEqual([closedRoute as string]);
    expect(re?.active[0]?.region).toBe('North');

    expect(re?.forecast?.id).toBe('evForecast');
    expect(re?.forecast?.kind).toBe('SKY_LANTERN');
    expect(re?.forecast?.startRound).toBe(4);
    expect(re?.forecast?.durationRounds).toBe(2);
    expect(re?.forecast?.routeIds).toEqual([forecastRoute as string]);
    expect(re?.forecast?.region).toBe('South');
    expect(re?.forecast?.endsAfterRound).toBe(0); // N/A — not started

    expect(re?.hotspots.map((h) => ({ cityId: h.cityId, level: h.level }))).toEqual([
      { cityId: hotCity as string, level: 2 },
    ]);

    const openCharter = re?.charters.find((c) => c.id === 'evChOpen');
    const wonCharter = re?.charters.find((c) => c.id === 'evChWon');
    expect(openCharter).toMatchObject({
      cityA: charterA as string,
      cityB: charterB as string,
      points: 8,
      expiresAfterRound: 9,
      wonByPlayerId: '',
    });
    expect(wonCharter).toMatchObject({
      cityA: wonA as string,
      cityB: wonB as string,
      points: 12,
      expiresAfterRound: 9,
      wonByPlayerId: 'p1',
    });

    expect(re?.reopenBonusRouteIds).toEqual([reopenRoute as string]);
    expect(re?.closedRouteIds).toContain(closedRoute as string);
    expect(re?.freeStationAvailable).toBe(true);
    expect(decoded.players.find((player) => player.id === 'p1')).toMatchObject({
      bentoTokens: 2,
      blessings: 3,
      claimDiscounts: 1,
      repairPermits: 1,
    });
    expect(re?.active[1]?.cityPath).toEqual([
      hotCity as string,
      charterA as string,
      charterB as string,
    ]);
    expect(re?.active[1]?.position).toBe(1);
    expect(re?.lanternHost?.cityId).toBe(hotCity as string);
    expect(re?.luckyContracts[0]).toMatchObject({
      eventId: 'lucky',
      cityA: charterA as string,
      cityB: wonB as string,
      points: 5,
    });
    expect(re?.repairedRouteIds).toEqual([forecastRoute as string]);
    expect(re?.eventDraft?.currentPlayerId).toBe('p1');
    expect(re?.boringActive).toBe(true);
  });

  it('leaves random_events unset and events_mode "off" when the view carries no events block', () => {
    const board = taiwanBoard();
    const state = initGame(board, config); // no eventsMode configured → 'off', state.events absent
    const view = redactFor(board, state, p1);
    expect(view.events).toBeUndefined();

    const snap = viewToSnapshot(view, 0, p1);
    expect(snap.randomEvents).toBeUndefined();
    expect(snap.gameSettings?.eventsMode).toBe('off');
  });
});

describe('@trm/codec eventToProto — random events (M4)', () => {
  const roundTrip = (ev: GameEvent) => {
    const pb = eventToProto(ev, null);
    expect(pb).not.toBeNull();
    return fromBinary(GameEventSchema, toBinary(GameEventSchema, pb!));
  };

  it('round-trips EVENT_ANNOUNCED with routeIds + region', () => {
    const ev: GameEvent = {
      e: 'EVENT_ANNOUNCED',
      id: 'ev9',
      kind: 'SKY_LANTERN',
      startRound: 6,
      durationRounds: 2,
      routeIds: [asRouteId('R1'), asRouteId('R2')],
      region: 'East',
      visibility: 'PUBLIC',
    };
    const decoded = roundTrip(ev);
    expect(decoded.event.case).toBe('randomEventAnnounced');
    if (decoded.event.case !== 'randomEventAnnounced') throw new Error('unreachable');
    const info = decoded.event.value.info;
    expect(info?.id).toBe('ev9');
    expect(info?.kind).toBe('SKY_LANTERN');
    expect(info?.startRound).toBe(6);
    expect(info?.durationRounds).toBe(2);
    expect(info?.routeIds).toEqual(['R1', 'R2']);
    expect(info?.region).toBe('East');
    expect(info?.endsAfterRound).toBe(0); // forecast — not started
    expect(info?.charter).toBeUndefined();
  });

  it('round-trips EVENT_STARTED with a charter sub-message and a resolved ends_after_round', () => {
    const ev: GameEvent = {
      e: 'EVENT_STARTED',
      id: 'ev3',
      kind: 'CHARTER_SPECIAL',
      startRound: 5,
      durationRounds: 4,
      charter: { a: asCityId('TAIPEI'), b: asCityId('KAOHSIUNG'), points: 10 },
      visibility: 'PUBLIC',
    };
    const decoded = roundTrip(ev);
    expect(decoded.event.case).toBe('randomEventStarted');
    if (decoded.event.case !== 'randomEventStarted') throw new Error('unreachable');
    const info = decoded.event.value.info;
    expect(info?.id).toBe('ev3');
    expect(info?.startRound).toBe(5);
    expect(info?.durationRounds).toBe(4);
    expect(info?.endsAfterRound).toBe(8); // 5 + 4 - 1
    expect(info?.charter?.cityA).toBe('TAIPEI');
    expect(info?.charter?.cityB).toBe('KAOHSIUNG');
    expect(info?.charter?.points).toBe(10);
    expect(info?.charter?.expiresAfterRound).toBe(8);
    expect(info?.charter?.wonByPlayerId).toBe('');
  });

  it('round-trips EVENT_STARTED for an instant kind (VIRAL_HOTSPOT) with ends_after_round 0', () => {
    const ev: GameEvent = {
      e: 'EVENT_STARTED',
      id: 'ev5',
      kind: 'VIRAL_HOTSPOT',
      startRound: 5,
      durationRounds: 0,
      cityId: asCityId('TAIPEI'),
      visibility: 'PUBLIC',
    };
    const decoded = roundTrip(ev);
    expect(decoded.event.case).toBe('randomEventStarted');
    if (decoded.event.case !== 'randomEventStarted') throw new Error('unreachable');
    expect(decoded.event.value.info?.endsAfterRound).toBe(0);
    expect(decoded.event.value.info?.cityId).toBe('TAIPEI');
    expect(decoded.event.value.info?.charter).toBeUndefined();
  });

  it('round-trips EVENT_ENDED', () => {
    const ev: GameEvent = {
      e: 'EVENT_ENDED',
      id: 'ev1',
      kind: 'TYPHOON_LANDFALL',
      visibility: 'PUBLIC',
    };
    const decoded = roundTrip(ev);
    expect(decoded.event.case).toBe('randomEventEnded');
    if (decoded.event.case !== 'randomEventEnded') throw new Error('unreachable');
    expect(decoded.event.value.id).toBe('ev1');
    expect(decoded.event.value.kind).toBe('TYPHOON_LANDFALL');
  });

  it('round-trips EVENT_BONUS reason HOTSPOT (cityId, no routeId)', () => {
    const ev: GameEvent = {
      e: 'EVENT_BONUS',
      kind: 'VIRAL_HOTSPOT',
      reason: 'HOTSPOT',
      player: p1,
      points: 2,
      cityId: asCityId('TAIPEI'),
      visibility: 'PUBLIC',
    };
    const decoded = roundTrip(ev);
    if (decoded.event.case !== 'randomEventBonus') throw new Error('unreachable');
    const v = decoded.event.value;
    expect(v.kind).toBe('VIRAL_HOTSPOT');
    expect(v.reason).toBe('HOTSPOT');
    expect(v.playerId).toBe('p1');
    expect(v.points).toBe(2);
    expect(v.cityId).toBe('TAIPEI');
    expect(v.routeId).toBe('');
  });

  it('round-trips EVENT_BONUS reason REOPEN (routeId, no cityId)', () => {
    const ev: GameEvent = {
      e: 'EVENT_BONUS',
      kind: 'TYPHOON_LANDFALL',
      reason: 'REOPEN',
      player: p1,
      points: 2,
      routeId: asRouteId('R7'),
      visibility: 'PUBLIC',
    };
    const decoded = roundTrip(ev);
    if (decoded.event.case !== 'randomEventBonus') throw new Error('unreachable');
    const v = decoded.event.value;
    expect(v.reason).toBe('REOPEN');
    expect(v.routeId).toBe('R7');
    expect(v.cityId).toBe('');
  });

  it('round-trips EVENT_BONUS reason STAMP (cityId, no routeId)', () => {
    const ev: GameEvent = {
      e: 'EVENT_BONUS',
      kind: 'STAMP_RALLY',
      reason: 'STAMP',
      player: p1,
      points: 1,
      cityId: asCityId('KAOHSIUNG'),
      visibility: 'PUBLIC',
    };
    const decoded = roundTrip(ev);
    if (decoded.event.case !== 'randomEventBonus') throw new Error('unreachable');
    const v = decoded.event.value;
    expect(v.reason).toBe('STAMP');
    expect(v.cityId).toBe('KAOHSIUNG');
    expect(v.routeId).toBe('');
  });

  it('round-trips EVENT_BONUS reason CHARTER (neither routeId nor cityId)', () => {
    const ev: GameEvent = {
      e: 'EVENT_BONUS',
      kind: 'CHARTER_SPECIAL',
      reason: 'CHARTER',
      player: p1,
      points: 10,
      visibility: 'PUBLIC',
    };
    const decoded = roundTrip(ev);
    if (decoded.event.case !== 'randomEventBonus') throw new Error('unreachable');
    const v = decoded.event.value;
    expect(v.reason).toBe('CHARTER');
    expect(v.routeId).toBe('');
    expect(v.cityId).toBe('');
    expect(v.points).toBe(10);
  });

  it('round-trips EVENT_BONUS reason FREE_STATION (cityId, no routeId, zero points)', () => {
    const ev: GameEvent = {
      e: 'EVENT_BONUS',
      kind: 'RAILWAY_GALA',
      reason: 'FREE_STATION',
      player: p1,
      points: 0,
      cityId: asCityId('KAOHSIUNG'),
      visibility: 'PUBLIC',
    };
    const decoded = roundTrip(ev);
    if (decoded.event.case !== 'randomEventBonus') throw new Error('unreachable');
    const v = decoded.event.value;
    expect(v.reason).toBe('FREE_STATION');
    expect(v.routeId).toBe('');
    expect(v.cityId).toBe('KAOHSIUNG');
    expect(v.points).toBe(0);
  });

  it('maps every expansion follow-up event and the harvest recycle reason', () => {
    const moved = roundTrip({
      e: 'EVENT_MARKER_MOVED',
      kind: 'LANTERN_HOST_CITY',
      id: 'lantern',
      cityId: asCityId('TAIPEI'),
      player: p1,
      visibility: 'PUBLIC',
    });
    expect(moved.event.case).toBe('eventMarkerMoved');
    if (moved.event.case !== 'eventMarkerMoved') throw new Error('unreachable');
    expect(moved.event.value).toMatchObject({
      kind: 'LANTERN_HOST_CITY',
      cityId: 'TAIPEI',
      playerId: 'p1',
    });

    const swap = roundTrip({
      e: 'EVENT_NIGHT_MARKET_SWAPPED',
      player: p1,
      slot: 2,
      gave: 'RED',
      took: 'BLUE',
      visibility: 'PUBLIC',
    });
    expect(swap.event.case).toBe('eventNightMarketSwapped');

    const perk = roundTrip({
      e: 'EVENT_PERK_CHOSEN',
      player: p1,
      perk: 'DRAW_TWO',
      visibility: 'PUBLIC',
    });
    expect(perk.event.case).toBe('eventPerkChosen');

    const reveal = roundTrip({
      e: 'EVENT_HIVE_CARD_REVEALED',
      player: p1,
      card: 'GREEN',
      count: 3,
      visibility: 'PUBLIC',
    });
    expect(reveal.event.case).toBe('eventHiveCardRevealed');

    const hive = roundTrip({
      e: 'EVENT_HIVE_RESOLVED',
      player: p1,
      busted: false,
      keptCount: 3,
      visibility: 'PUBLIC',
    });
    expect(hive.event.case).toBe('eventHiveResolved');

    const recycled = roundTrip({
      e: 'MARKET_RECYCLED',
      reason: 'THREE_OF_COLOR',
      visibility: 'PUBLIC',
    });
    expect(recycled.event.case).toBe('marketRecycled');
    if (recycled.event.case !== 'marketRecycled') throw new Error('unreachable');
    expect(recycled.event.value.reason).toBe('THREE_OF_COLOR');
  });
});

describe('@trm/codec rejectionToPb — random-events rule violations (M1/M4)', () => {
  it('maps ROUTE_CLOSED_BY_EVENT / EVENT_CLAIMS_SUSPENDED / EVENT_STATIONS_SUSPENDED to 126/127/128', () => {
    expect(rejectionToPb('ROUTE_CLOSED_BY_EVENT')).toBe(RejectionCode.ROUTE_CLOSED_BY_EVENT);
    expect(RejectionCode.ROUTE_CLOSED_BY_EVENT).toBe(126);
    expect(rejectionToPb('EVENT_CLAIMS_SUSPENDED')).toBe(RejectionCode.EVENT_CLAIMS_SUSPENDED);
    expect(RejectionCode.EVENT_CLAIMS_SUSPENDED).toBe(127);
    expect(rejectionToPb('EVENT_STATIONS_SUSPENDED')).toBe(RejectionCode.EVENT_STATIONS_SUSPENDED);
    expect(RejectionCode.EVENT_STATIONS_SUSPENDED).toBe(128);
  });

  it('maps every expansion rejection to its stable wire code', () => {
    expect(rejectionToPb('EVENT_FACEUP_LOCO_BLOCKED')).toBe(129);
    expect(rejectionToPb('EVENT_REPAIR_UNAVAILABLE')).toBe(130);
    expect(rejectionToPb('EVENT_REPAIR_PAYMENT_INVALID')).toBe(131);
    expect(rejectionToPb('EVENT_NIGHT_MARKET_UNAVAILABLE')).toBe(132);
    expect(rejectionToPb('EVENT_LANTERN_RELOCATION_INVALID')).toBe(133);
    expect(rejectionToPb('EVENT_DRAFT_CHOICE_INVALID')).toBe(134);
    expect(rejectionToPb('EVENT_HIVE_UNAVAILABLE')).toBe(135);
    expect(rejectionToPb('EVENT_RESOURCE_UNAVAILABLE')).toBe(136);
  });
});
