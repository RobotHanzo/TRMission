import { describe, it, expect } from 'vitest';
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import {
  CardColor,
  Phase,
  ClientEnvelopeSchema,
  ServerEnvelopeSchema,
  GameSnapshotSchema,
  PROTOCOL_VERSION,
} from '../src/index';

describe('@trm/proto wire round-trip', () => {
  it('round-trips a ClaimRoute command envelope', () => {
    const env = create(ClientEnvelopeSchema, {
      clientSeq: 7,
      command: {
        case: 'claimRoute',
        value: {
          routeId: 'R50',
          payment: { color: CardColor.GREEN, colorCount: 6, locomotives: 2 },
        },
      },
    });

    const back = fromBinary(ClientEnvelopeSchema, toBinary(ClientEnvelopeSchema, env));

    expect(back.clientSeq).toBe(7);
    expect(back.command.case).toBe('claimRoute');
    if (back.command.case !== 'claimRoute') throw new Error('wrong case');
    expect(back.command.value.routeId).toBe('R50');
    expect(back.command.value.payment?.color).toBe(CardColor.GREEN);
    expect(back.command.value.payment?.colorCount).toBe(6);
    expect(back.command.value.payment?.locomotives).toBe(2);
  });

  it('round-trips a Hello envelope carrying the ticket + protocol version', () => {
    const env = create(ClientEnvelopeSchema, {
      clientSeq: 1,
      command: {
        case: 'hello',
        value: { ticket: 'ws.jwt.token', protocolVersion: PROTOCOL_VERSION },
      },
    });
    const back = fromBinary(ClientEnvelopeSchema, toBinary(ClientEnvelopeSchema, env));
    expect(back.command.case).toBe('hello');
    if (back.command.case !== 'hello') throw new Error('wrong case');
    expect(back.command.value.ticket).toBe('ws.jwt.token');
    expect(back.command.value.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('round-trips a CameraUpdate command carrying a board-space view', () => {
    const env = create(ClientEnvelopeSchema, {
      clientSeq: 11,
      command: { case: 'cameraUpdate', value: { view: { cx: 50, cy: 42.5, span: 30 } } },
    });
    const back = fromBinary(ClientEnvelopeSchema, toBinary(ClientEnvelopeSchema, env));
    expect(back.command.case).toBe('cameraUpdate');
    if (back.command.case !== 'cameraUpdate') throw new Error('wrong case');
    expect(back.command.value.view?.cx).toBeCloseTo(50);
    expect(back.command.value.view?.cy).toBeCloseTo(42.5);
    expect(back.command.value.view?.span).toBeCloseTo(30);
  });

  it('round-trips a CameraMoved event addressed to a player', () => {
    const env = create(ServerEnvelopeSchema, {
      serverSeq: 9,
      event: { case: 'cameraMoved', value: { playerId: 'p2', view: { cx: 12, cy: 80, span: 18 } } },
    });
    const back = fromBinary(ServerEnvelopeSchema, toBinary(ServerEnvelopeSchema, env));
    expect(back.event.case).toBe('cameraMoved');
    if (back.event.case !== 'cameraMoved') throw new Error('wrong case');
    expect(back.event.value.playerId).toBe('p2');
    expect(back.event.value.view?.span).toBeCloseTo(18);
  });

  it('round-trips a server Rejection with an i18n message key', () => {
    const env = create(ServerEnvelopeSchema, {
      serverSeq: 42,
      ackClientSeq: 7,
      event: {
        case: 'rejection',
        value: {
          ackClientSeq: 7,
          code: 107,
          messageKey: 'errors:routeTaken',
          message: 'Route already claimed',
        },
      },
    });
    const back = fromBinary(ServerEnvelopeSchema, toBinary(ServerEnvelopeSchema, env));
    expect(back.event.case).toBe('rejection');
    if (back.event.case !== 'rejection') throw new Error('wrong case');
    expect(back.event.value.messageKey).toBe('errors:routeTaken');
    expect(back.event.value.ackClientSeq).toBe(7);
  });

  it('snapshot keeps opponents counts-only while the viewer keeps their own secrets (risk #1)', () => {
    const snap = create(GameSnapshotSchema, {
      stateVersion: 5,
      schemaVersion: 1,
      contentHash: 'abc123',
      phase: Phase.AWAIT_ACTION,
      orderIndex: 0,
      currentPlayerId: 'p1',
      turnOrder: ['p1', 'p2'],
      market: [
        CardColor.RED,
        CardColor.UNSPECIFIED,
        CardColor.LOCOMOTIVE,
        CardColor.BLUE,
        CardColor.WHITE,
      ],
      deckCount: 90,
      players: [
        {
          id: 'p1',
          seat: 0,
          trainCars: 45,
          stationsRemaining: 3,
          routePoints: 0,
          handCount: 4,
          ticketCount: 2,
        },
        {
          id: 'p2',
          seat: 1,
          trainCars: 45,
          stationsRemaining: 3,
          routePoints: 0,
          handCount: 4,
          ticketCount: 2,
        },
      ],
      you: {
        playerId: 'p1',
        hand: { red: 2, green: 1, locomotive: 1 },
        keptTicketIds: ['L1', 'S6'],
        pendingOfferTicketIds: [],
      },
    });

    const back = fromBinary(GameSnapshotSchema, toBinary(GameSnapshotSchema, snap));

    // Opponents expose only counts — there is no field on PublicPlayerState that
    // could carry a hand, a card colour, or a ticket id.
    const opponent = back.players.find((p) => p.id === 'p2');
    expect(opponent?.handCount).toBe(4);
    expect(opponent?.ticketCount).toBe(2);
    expect(Object.keys(opponent ?? {})).not.toContain('hand');

    // The viewer's own secrets survive the round-trip.
    expect(back.you?.playerId).toBe('p1');
    expect(back.you?.hand?.red).toBe(2);
    expect(back.you?.keptTicketIds).toEqual(['L1', 'S6']);
    // Empty market slot encodes as UNSPECIFIED.
    expect(back.market[1]).toBe(CardColor.UNSPECIFIED);
  });

  it('round-trips a HistoryReplay envelope with chat entries', () => {
    const env = create(ServerEnvelopeSchema, {
      serverSeq: 3,
      event: {
        case: 'history',
        value: {
          stateVersion: 12,
          events: [],
          chat: [{ playerId: 'p2', text: 'hello', ts: 1719600000000n }],
        },
      },
    });
    const back = fromBinary(ServerEnvelopeSchema, toBinary(ServerEnvelopeSchema, env));
    expect(back.event.case).toBe('history');
    if (back.event.case !== 'history') throw new Error('wrong case');
    expect(back.event.value.stateVersion).toBe(12);
    expect(back.event.value.chat[0]?.text).toBe('hello');
    expect(back.event.value.chat[0]?.ts).toBe(1719600000000n);
  });
});
