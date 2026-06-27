import { describe, it, expect, beforeEach } from 'vitest';
import { legalActions, taiwanBoard, CONTENT_HASH, type Action, type PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { RejectionCode, CardColor, type ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import type { MetricsHooks } from '../src/observability/hooks';
import { encodeClient, decodeServer, actionToCommand } from './helpers';

// The server must NEVER trust the client: every illegal/forged frame is rejected with
// zero state mutation, and hidden information never reaches the wire.
function counters() {
  const c = { rejections: 0, leaks: 0, applied: 0 };
  const metrics: MetricsHooks = {
    commandReceived() {},
    commandRejected() {
      c.rejections += 1;
    },
    commandApplied() {
      c.applied += 1;
    },
    connectionOpened() {},
    connectionClosed() {},
    leakBlocked() {
      c.leaks += 1;
    },
  };
  return { c, metrics };
}

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];

describe('anti-cheat: the server rejects illegal & forged frames', () => {
  let hub: GameHub;
  let registry: GameRegistry;
  let stats: ReturnType<typeof counters>['c'];
  const frames = new Map<string, ServerEnvelope[]>();
  const seq = new Map<string, number>();
  const board = taiwanBoard();

  const open = (id: string) => {
    frames.set(id, []);
    seq.set(id, 0);
    hub.openConnection(id, (b) => frames.get(id)!.push(decodeServer(b)));
  };
  const send = (id: string, command: ReturnType<typeof actionToCommand>) =>
    hub.receive(id, encodeClient((seq.get(id) ?? 0) + 1, command));
  const helloAs = (id: string, playerId: string, seat: number) =>
    hub.receive(
      id,
      encodeClient((seq.get(id) ?? 0) + 1, {
        case: 'hello',
        value: { ticket: makeDevTicket({ gameId: 'evil', playerId, seat }), protocolVersion: 1 },
      }),
    );
  const lastRejection = (id: string): number | null => {
    for (const f of [...(frames.get(id) ?? [])].reverse())
      if (f.event.case === 'rejection') return f.event.value.code;
    return null;
  };

  beforeEach(async () => {
    const m = counters();
    stats = m.c;
    registry = new GameRegistry();
    hub = new GameHub(registry, { metrics: m.metrics });
    await hub.createMatch('evil', board, { seed: 'evil-1', players, contentHash: CONTENT_HASH });
    frames.clear();
    seq.clear();
  });

  const session = () => registry.get('evil')!.session;
  const startGame = async () => {
    open('a');
    open('b');
    await helloAs('a', 'p1', 0);
    await helloAs('b', 'p2', 1);
    while (session().phase === 'SETUP_TICKETS') {
      const player = players.map((p) => p.id).find((p) => session().hasPendingOffer(p))!;
      const keep = legalActions(board, session().raw(), player)[0] as Action;
      const conn = player === asPlayerId('p1') ? 'a' : 'b';
      seq.set(conn, (seq.get(conn) ?? 0) + 1);
      await send(conn, actionToCommand(keep));
    }
  };

  it('refuses a forged ws ticket (unknown player / wrong seat)', async () => {
    open('x');
    await hub.receive(
      'x',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'evil', playerId: 'p9', seat: 0 }),
          protocolVersion: 1,
        },
      }),
    );
    expect(lastRejection('x')).toBe(RejectionCode.UNAUTHENTICATED);

    open('y');
    await hub.receive(
      'y',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'evil', playerId: 'p1', seat: 3 }),
          protocolVersion: 1,
        },
      }),
    );
    expect(lastRejection('y')).toBe(RejectionCode.UNAUTHENTICATED);
  });

  it('refuses commands from an unbound socket', async () => {
    open('z');
    await send('z', { case: 'drawBlind', value: {} });
    expect(lastRejection('z')).toBe(RejectionCode.UNAUTHENTICATED);
  });

  it('rejects a malformed frame without crashing', async () => {
    open('m');
    await hub.receive('m', new Uint8Array([0xff, 0x01, 0x99, 0x7f]));
    expect(lastRejection('m')).toBe(RejectionCode.MALFORMED);
  });

  it('rejects acting out of turn with no state change', async () => {
    await startGame();
    expect(session().phase).toBe('AWAIT_ACTION');
    expect(session().currentPlayer).toBe(asPlayerId('p1'));

    const before = session().stateVersion;
    seq.set('b', (seq.get('b') ?? 0) + 1);
    await send('b', { case: 'drawBlind', value: {} }); // p2 acts on p1's turn
    expect(lastRejection('b')).toBe(RejectionCode.NOT_YOUR_TURN);
    expect(session().stateVersion).toBe(before);
  });

  it('rejects an unaffordable / wrong-colour claim with no state change', async () => {
    await startGame();
    const before = session().stateVersion;
    seq.set('a', (seq.get('a') ?? 0) + 1);
    // R1 (基隆–瑞芳) is a Yellow length-1 route; paying RED is invalid.
    await send('a', {
      case: 'claimRoute',
      value: { routeId: 'R1', payment: { color: CardColor.RED, colorCount: 1, locomotives: 0 } },
    });
    const code = lastRejection('a');
    expect(code).not.toBeNull();
    expect(session().stateVersion).toBe(before);
  });

  it('never leaks hidden info (egress guard never fires) and counts rejections', async () => {
    await startGame();
    // Exercise a few illegal attempts.
    seq.set('b', (seq.get('b') ?? 0) + 1);
    await send('b', { case: 'pass', value: {} }); // not your turn
    seq.set('a', (seq.get('a') ?? 0) + 1);
    await send('a', {
      case: 'buildStation',
      value: {
        cityId: 'NOPE',
        payment: { color: CardColor.UNSPECIFIED, colorCount: 0, locomotives: 1 },
      },
    });

    expect(stats.leaks).toBe(0);
    expect(stats.rejections).toBeGreaterThan(0);
    // No frame addressed to p2 ever carried p1's private SelfView.
    for (const f of frames.get('b') ?? []) {
      if (f.event.case === 'snapshot' && f.event.value.snapshot?.you) {
        expect(f.event.value.snapshot.you.playerId).toBe('p2');
      }
    }
  });
});
