import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type PlayerSeed } from '@trm/engine';
import { asPlayerId, SESSION_REPLACED_CLOSE_CODE } from '@trm/shared';
import { RejectionCode, type ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient, decodeServer } from './helpers';

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
  { id: asPlayerId('p3'), seat: 2 },
];
const gameId = 'sess';

interface Wired {
  hub: GameHub;
  received: Map<string, ServerEnvelope[]>;
  terminated: Map<string, [number, string]>;
  seq: Map<string, number>;
}

async function wireGame(): Promise<Wired> {
  const hub = new GameHub(new GameRegistry());
  await hub.createMatch(gameId, taiwanBoard(), {
    seed: 'sess-1',
    players,
    contentHash: CONTENT_HASH,
  });
  return { hub, received: new Map(), terminated: new Map(), seq: new Map() };
}

/** Open a new connection (its own connId) whose frames + terminate call are captured. */
function openConn(w: Wired, connId: string): void {
  w.received.set(connId, []);
  w.seq.set(connId, 0);
  w.hub.openConnection(
    connId,
    (bytes) => w.received.get(connId)!.push(decodeServer(bytes)),
    (code, reason) => w.terminated.set(connId, [code, reason]),
  );
}

const hello = async (w: Wired, connId: string, pid: string, seat: number): Promise<void> => {
  const next = (w.seq.get(connId) ?? 0) + 1;
  w.seq.set(connId, next);
  await w.hub.receive(
    connId,
    encodeClient(next, {
      case: 'hello',
      value: { ticket: makeDevTicket({ gameId, playerId: pid, seat }), protocolVersion: 2 },
    }),
  );
};

const rejections = (w: Wired, connId: string): ServerEnvelope[] =>
  (w.received.get(connId) ?? []).filter((f) => f.event.case === 'rejection');

describe('single connection per seat', () => {
  it('kicks the older connection when a second Hello binds the same seat', async () => {
    const w = await wireGame();
    openConn(w, 'p1-a');
    openConn(w, 'p1-b');

    await hello(w, 'p1-a', 'p1', 0);
    await hello(w, 'p1-b', 'p1', 0); // same seat, a different connection

    const rej = rejections(w, 'p1-a');
    expect(rej).toHaveLength(1);
    const frame = rej[0];
    if (frame?.event.case !== 'rejection') throw new Error('unreachable');
    expect(frame.event.value.code).toBe(RejectionCode.SESSION_REPLACED);
    expect(frame.event.value.messageKey).toBe('errors:sessionReplaced');
    expect(w.terminated.get('p1-a')).toEqual([SESSION_REPLACED_CLOSE_CODE, 'session_replaced']);

    // The newer connection was never touched and keeps playing normally.
    expect(w.terminated.get('p1-b')).toBeUndefined();
    expect(rejections(w, 'p1-b')).toHaveLength(0);
  });

  it('does not kick itself on a same-connection reconnect (same connId re-Hello)', async () => {
    const w = await wireGame();
    openConn(w, 'p1-a');

    await hello(w, 'p1-a', 'p1', 0);
    await hello(w, 'p1-a', 'p1', 0); // reconnect: same connId, same seat

    expect(w.terminated.get('p1-a')).toBeUndefined();
    expect(rejections(w, 'p1-a')).toHaveLength(0);
  });

  it('does not affect a different seat in the same room', async () => {
    const w = await wireGame();
    openConn(w, 'p1-a');
    openConn(w, 'p2-a');

    await hello(w, 'p1-a', 'p1', 0);
    await hello(w, 'p2-a', 'p2', 1);

    expect(w.terminated.get('p1-a')).toBeUndefined();
    expect(w.terminated.get('p2-a')).toBeUndefined();
  });
});
