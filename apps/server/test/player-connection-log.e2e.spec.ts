import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import type { ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient, decodeServer } from './helpers';

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
  { id: asPlayerId('p3'), seat: 2 },
];
const gameId = 'conn-log';

interface Wired {
  hub: GameHub;
  received: Map<string, ServerEnvelope[]>;
  seq: Map<string, number>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function wireGame(playerLeftDelayMs: number): Promise<Wired> {
  const hub = new GameHub(new GameRegistry(), { playerLeftDelayMs });
  await hub.createMatch(gameId, taiwanBoard(), {
    seed: 'conn-log-1',
    players,
    contentHash: CONTENT_HASH,
  });
  const received = new Map<string, ServerEnvelope[]>();
  const seq = new Map<string, number>();
  for (const p of players) {
    const pid = p.id as string;
    received.set(pid, []);
    seq.set(pid, 0);
  }
  return { hub, received, seq };
}

const open = (w: Wired, pid: string): void => {
  if (!w.received.has(pid)) w.received.set(pid, []);
  w.hub.openConnection(pid, (bytes) => w.received.get(pid)!.push(decodeServer(bytes)));
};

const hello = async (w: Wired, pid: string, seat: number): Promise<void> => {
  const next = (w.seq.get(pid) ?? 0) + 1;
  w.seq.set(pid, next);
  await w.hub.receive(
    pid,
    encodeClient(next, {
      case: 'hello',
      value: { ticket: makeDevTicket({ gameId, playerId: pid, seat }), protocolVersion: 2 },
    }),
  );
};

const connFrames = (w: Wired, pid: string): ServerEnvelope[] =>
  (w.received.get(pid) ?? []).filter((f) => f.event.case === 'playerConnectionChanged');

const historyFrame = (w: Wired, pid: string): ServerEnvelope | undefined =>
  [...(w.received.get(pid) ?? [])].reverse().find((f) => f.event.case === 'history');

describe('player-connection log (issue #16)', () => {
  it('debounces a dropped connection: no notice at all if it reconnects within the window', async () => {
    const w = await wireGame(1000);
    for (const p of players) {
      open(w, p.id as string);
      await hello(w, p.id as string, p.seat);
    }

    w.hub.closeConnection('p1');
    open(w, 'p1');
    await hello(w, 'p1', 0); // reconnects well within the 1s debounce window

    expect(connFrames(w, 'p2')).toHaveLength(0);
    expect(connFrames(w, 'p3')).toHaveLength(0);
    expect(connFrames(w, 'p1')).toHaveLength(0);
  });

  it('fires a "left" notice to other members + spectators once the debounce elapses, then a "reconnected" notice on return', async () => {
    const w = await wireGame(20);
    for (const p of players) {
      open(w, p.id as string);
      await hello(w, p.id as string, p.seat);
    }
    open(w, 'spec1');
    await w.hub.receive(
      'spec1',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId, playerId: 'spec1', seat: -1 }),
          protocolVersion: 2,
        },
      }),
    );

    w.hub.closeConnection('p1');
    await sleep(60);

    for (const pid of ['p2', 'p3', 'spec1']) {
      const frames = connFrames(w, pid);
      expect(frames, `${pid} got the left notice`).toHaveLength(1);
      const f = frames[0];
      if (f?.event.case !== 'playerConnectionChanged') throw new Error('unreachable');
      expect(f.event.value.playerId).toBe('p1');
      expect(f.event.value.connected).toBe(false);
    }

    open(w, 'p1');
    await hello(w, 'p1', 0);
    for (const pid of ['p2', 'p3', 'spec1']) {
      const frames = connFrames(w, pid);
      expect(frames, `${pid} got the reconnected notice`).toHaveLength(2);
      const f = frames[1];
      if (f?.event.case !== 'playerConnectionChanged') throw new Error('unreachable');
      expect(f.event.value.playerId).toBe('p1');
      expect(f.event.value.connected).toBe(true);
    }
  });

  it('never fires for a game already at GAME_OVER, and cleans up on evictMatch', async () => {
    const w = await wireGame(10);
    for (const p of players) {
      open(w, p.id as string);
      await hello(w, p.id as string, p.seat);
    }
    w.hub.closeConnection('p2');
    await w.hub.evictMatch(gameId, 'terminated for test');
    await sleep(30);
    expect(connFrames(w, 'p3')).toHaveLength(0);
  });

  it('backfills a member who reconnects after a "left" notice fired, with the log spliced in', async () => {
    const w = await wireGame(15);
    for (const p of players) {
      open(w, p.id as string);
      await hello(w, p.id as string, p.seat);
    }
    w.hub.closeConnection('p1');
    await sleep(50);

    // p2 reconnects (drops + re-hellos) — its NEXT history backfill must carry p1's left notice.
    w.hub.closeConnection('p2');
    open(w, 'p2');
    w.received.set('p2', []); // only inspect frames from this fresh connection
    await hello(w, 'p2', 1);

    const frame = historyFrame(w, 'p2');
    expect(frame?.event.case).toBe('history');
    if (frame?.event.case !== 'history') throw new Error('unreachable');
    expect(frame.event.value.connectionLog).toHaveLength(1);
    expect(frame.event.value.connectionLog[0]?.playerId).toBe('p1');
    expect(frame.event.value.connectionLog[0]?.connected).toBe(false);
  });
});
