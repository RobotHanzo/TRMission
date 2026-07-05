import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type GameConfig, type PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { RejectionCode, type ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient, decodeServer, pickAction } from './helpers';

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];
const config: GameConfig = { seed: 'hc-1', players, contentHash: CONTENT_HASH };

function hello(pid: string, seat: number, seq: number) {
  return encodeClient(seq, {
    case: 'hello',
    value: { ticket: makeDevTicket({ gameId: 'g', playerId: pid, seat }), protocolVersion: 1 },
  });
}
const historyOf = (frames: ServerEnvelope[]) =>
  frames.find((f) => f.event.case === 'history')?.event.value as
    | {
        events: { event: { case?: string; value?: unknown } }[];
        chat: { content: { case: string; value: string } }[];
      }
    | undefined;

describe('history + chat over the hub', () => {
  it('backfills the redacted event history on hello and never leaks offered tickets', async () => {
    const board = taiwanBoard();
    const hub = new GameHub(new GameRegistry());
    const match = await hub.createMatch('g', board, config);

    // Drive a handful of moves directly on the session (populates appliedActions).
    for (let i = 0; i < 12 && match.session.phase !== 'GAME_OVER'; i++) {
      const state = match.session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? players.map((p) => p.id).find((p) => match.session.hasPendingOffer(p))
          : match.session.currentPlayer;
      if (!actor) break;
      match.session.apply(pickAction(board, state, actor));
    }

    const frames: ServerEnvelope[] = [];
    hub.openConnection('c2', (b) => frames.push(decodeServer(b)));
    await hub.receive('c2', hello('p2', 1, 1));

    const h = historyOf(frames);
    expect(h).toBeTruthy();
    // p2 must NOT see p1's private ticket offers in the backfilled history…
    const cases = h!.events.map((e) => e.event.case);
    expect(cases).not.toContain('initialTicketsOffered');
    expect(cases).not.toContain('ticketsOffered');
    // …and must receive at least the public game-started / turn-started events.
    expect(cases).toContain('turnStarted');
  });

  it('broadcasts chat to members, persists it, and enforces length + rate limits', async () => {
    const board = taiwanBoard();
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g', board, config);

    const f1: ServerEnvelope[] = [];
    const f2: ServerEnvelope[] = [];
    hub.openConnection('c1', (b) => f1.push(decodeServer(b)));
    hub.openConnection('c2', (b) => f2.push(decodeServer(b)));
    await hub.receive('c1', hello('p1', 0, 1));
    await hub.receive('c2', hello('p2', 1, 1));
    f1.length = 0;
    f2.length = 0;

    await hub.receive(
      'c1',
      encodeClient(2, {
        case: 'chat',
        value: { content: { case: 'text', value: '  hi there  ' } },
      }),
    );
    const chat1 = f1.find((f) => f.event.case === 'chat')?.event.value as
      | { content: { case: string; value: string } }
      | undefined;
    const chat2 = f2.find((f) => f.event.case === 'chat')?.event.value as
      | { content: { case: string; value: string } }
      | undefined;
    expect(chat1?.content).toEqual({ case: 'text', value: 'hi there' }); // trimmed
    expect(chat2?.content).toEqual({ case: 'text', value: 'hi there' }); // both members receive it

    // Over-length → MALFORMED rejection, nothing broadcast.
    f2.length = 0;
    await hub.receive(
      'c1',
      encodeClient(3, {
        case: 'chat',
        value: { content: { case: 'text', value: 'x'.repeat(2049) } },
      }),
    );
    const rej = f1.find((f) => f.event.case === 'rejection')?.event.value as
      | { code: number }
      | undefined;
    expect(rej?.code).toBe(RejectionCode.MALFORMED);
    expect(f2.find((f) => f.event.case === 'chat')).toBeUndefined();

    // Rate limit: 5 allowed in the window, the 6th is rejected.
    for (let i = 0; i < 6; i++) {
      await hub.receive(
        'c1',
        encodeClient(10 + i, {
          case: 'chat',
          value: { content: { case: 'text', value: `m${i}` } },
        }),
      );
    }
    const lastRej = (
      f1.filter((f) => f.event.case === 'rejection').pop()?.event.value as { code: number }
    ).code;
    expect(lastRej).toBe(RejectionCode.RATE_LIMITED);
  });

  it('broadcasts a preset chat message and rejects an unrecognized preset id', async () => {
    const board = taiwanBoard();
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g', board, config);

    const f1: ServerEnvelope[] = [];
    const f2: ServerEnvelope[] = [];
    hub.openConnection('c1', (b) => f1.push(decodeServer(b)));
    hub.openConnection('c2', (b) => f2.push(decodeServer(b)));
    await hub.receive('c1', hello('p1', 0, 1));
    await hub.receive('c2', hello('p2', 1, 1));
    f1.length = 0;
    f2.length = 0;

    await hub.receive(
      'c1',
      encodeClient(2, {
        case: 'chat',
        value: { content: { case: 'presetId', value: 'GOOD_LUCK' } },
      }),
    );
    const chat2 = f2.find((f) => f.event.case === 'chat')?.event.value as
      | { content: { case: string; value: string } }
      | undefined;
    expect(chat2?.content).toEqual({ case: 'presetId', value: 'GOOD_LUCK' });

    f1.length = 0;
    await hub.receive(
      'c1',
      encodeClient(3, {
        case: 'chat',
        value: { content: { case: 'presetId', value: 'NOT_REAL' } },
      }),
    );
    const rej = f1.find((f) => f.event.case === 'rejection')?.event.value as
      | { code: number; messageKey: string }
      | undefined;
    expect(rej?.code).toBe(RejectionCode.MALFORMED);
    expect(rej?.messageKey).toBe('errors:chatInvalidPreset');
  });
});
