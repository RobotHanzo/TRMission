import { describe, it, expect } from 'vitest';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { GameEventSchema, CardColor, EventPerk } from '@trm/proto';
import { entriesFromEvents } from './logModel';

const ev = (event: NonNullable<MessageInitShape<typeof GameEventSchema>['event']>) =>
  create(GameEventSchema, { event });

describe('entriesFromEvents', () => {
  it('maps important actions with the right importance', () => {
    const out = entriesFromEvents([
      ev({ case: 'routeClaimed', value: { playerId: 'p1', routeId: 'R1', pointsAwarded: 7 } }),
      ev({ case: 'stationBuilt', value: { playerId: 'p2', cityId: 'C9' } }),
      ev({ case: 'endgameTriggered', value: { playerId: 'p1', finalTurnsRemaining: 2 } }),
      ev({ case: 'ticketCompleted', value: { playerId: 'p1', ticketId: 'S17' } }),
    ]);
    expect(out).toEqual([
      {
        kind: 'routeClaimed',
        playerId: 'p1',
        data: { routeId: 'R1', points: 7 },
        importance: 'highlight',
      },
      { kind: 'stationBuilt', playerId: 'p2', data: { cityId: 'C9' }, importance: 'highlight' },
      { kind: 'endgame', playerId: 'p1', data: { turns: 2 }, importance: 'alert' },
      {
        kind: 'ticketCompleted',
        playerId: 'p1',
        data: { ticketId: 'S17' },
        importance: 'highlight',
      },
    ]);
  });

  it('omits noisy ambient events', () => {
    const out = entriesFromEvents([
      ev({ case: 'marketRefilled', value: { market: [] } }),
      ev({ case: 'deckReshuffled', value: {} }),
      ev({ case: 'turnEnded', value: { playerId: 'p1' } }),
      ev({ case: 'initialTicketsOffered', value: { playerId: 'p1', ticketIds: ['L1'] } }),
    ]);
    expect(out).toEqual([]);
  });

  it('logs the reason for a market recycle', () => {
    const out = entriesFromEvents([
      ev({ case: 'marketRecycled', value: { reason: 'THREE_OF_COLOR' } }),
    ]);
    expect(out).toEqual([
      {
        kind: 'marketRecycled',
        playerId: null,
        data: { reason: 'THREE_OF_COLOR' },
        importance: 'normal',
      },
    ]);
  });

  it('maps expansion follow-up frames into readable log entries', () => {
    const out = entriesFromEvents([
      ev({
        case: 'eventMarkerMoved',
        value: { kind: 'LANTERN_HOST_CITY', id: 'e1', cityId: 'taipei', playerId: 'p1' },
      }),
      ev({
        case: 'eventNightMarketSwapped',
        value: { playerId: 'p1', slot: 0, gave: CardColor.RED, took: CardColor.BLUE },
      }),
      ev({
        case: 'eventPerkChosen',
        value: { playerId: 'p2', perk: EventPerk.DRAW_TWO },
      }),
      ev({
        case: 'eventHiveResolved',
        value: { playerId: 'p1', busted: true, keptCount: 1 },
      }),
    ]);
    expect(out).toEqual([
      {
        kind: 'eventMarkerMoved',
        playerId: 'p1',
        data: { eventKind: 'LANTERN_HOST_CITY', cityId: 'taipei' },
        importance: 'highlight',
      },
      { kind: 'eventNightMarketSwapped', playerId: 'p1', data: {}, importance: 'normal' },
      {
        kind: 'eventPerkChosen',
        playerId: 'p2',
        data: { perk: EventPerk.DRAW_TWO },
        importance: 'highlight',
      },
      {
        kind: 'eventHiveResolved',
        playerId: 'p1',
        data: { busted: true, keptCount: 1 },
        importance: 'alert',
      },
    ]);
  });

  it('reads the face-up card colour but not blind draws', () => {
    const out = entriesFromEvents([
      ev({ case: 'cardTakenFaceup', value: { playerId: 'p1', slot: 0, card: CardColor.BLUE } }),
      ev({ case: 'cardDrawnBlind', value: { playerId: 'p1', card: CardColor.UNSPECIFIED } }),
    ]);
    expect(out[0]).toMatchObject({ kind: 'tookFaceup', data: { color: 'BLUE' } });
    expect(out[1]).toMatchObject({ kind: 'drewBlind', data: {} });
  });

  it('maps the announce/start/end random-event frames with the right importance', () => {
    const out = entriesFromEvents([
      ev({ case: 'randomEventAnnounced', value: { info: { id: 'e1', kind: 'SKY_LANTERN' } } }),
      ev({ case: 'randomEventStarted', value: { info: { id: 'e2', kind: 'TYPHOON_LANDFALL' } } }),
      ev({ case: 'randomEventEnded', value: { id: 'e2', kind: 'TYPHOON_LANDFALL' } }),
    ]);
    expect(out).toEqual([
      {
        kind: 'eventAnnounced',
        playerId: null,
        data: { eventKind: 'SKY_LANTERN' },
        importance: 'alert',
      },
      {
        kind: 'eventStarted',
        playerId: null,
        data: { eventKind: 'TYPHOON_LANDFALL' },
        importance: 'alert',
      },
      {
        kind: 'eventEnded',
        playerId: null,
        data: { eventKind: 'TYPHOON_LANDFALL' },
        importance: 'normal',
      },
    ]);
  });

  it.each(['HOTSPOT', 'REOPEN', 'STAMP', 'CHARTER', 'FREE_STATION'] as const)(
    'maps an EVENT_BONUS (%s) to a highlighted entry carrying its reason + params',
    (reason) => {
      const [entry] = entriesFromEvents([
        ev({
          case: 'randomEventBonus',
          value: { kind: 'X', reason, playerId: 'p1', points: 2, routeId: 'R1', cityId: 'C1' },
        }),
      ]);
      expect(entry).toEqual({
        kind: 'eventBonus',
        playerId: 'p1',
        data: { reason, points: 2, cityId: 'C1', routeId: 'R1' },
        importance: 'highlight',
      });
    },
  );
});
