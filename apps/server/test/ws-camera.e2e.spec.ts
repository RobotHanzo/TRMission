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
const gameId = 'cam';

interface Wired {
  hub: GameHub;
  received: Map<string, ServerEnvelope[]>;
  seq: Map<string, number>;
}

async function wireGame(): Promise<Wired> {
  const hub = new GameHub(new GameRegistry());
  await hub.createMatch(gameId, taiwanBoard(), {
    seed: 'cam-1',
    players,
    contentHash: CONTENT_HASH,
  });
  const received = new Map<string, ServerEnvelope[]>();
  const seq = new Map<string, number>();
  for (const p of players) {
    const pid = p.id as string;
    received.set(pid, []);
    seq.set(pid, 0);
    hub.openConnection(pid, (bytes) => received.get(pid)!.push(decodeServer(bytes)));
  }
  return { hub, received, seq };
}

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

const sendCamera = async (
  w: Wired,
  pid: string,
  view: { cx: number; cy: number; span: number },
): Promise<void> => {
  const next = (w.seq.get(pid) ?? 0) + 1;
  w.seq.set(pid, next);
  await w.hub.receive(pid, encodeClient(next, { case: 'cameraUpdate', value: { view } }));
};

const cameraFrames = (w: Wired, pid: string): ServerEnvelope[] =>
  (w.received.get(pid) ?? []).filter((f) => f.event.case === 'cameraMoved');

describe('camera relay (follow the acting player) — ephemeral side channel', () => {
  it('fans a CameraUpdate out to the OTHER members only, never back to the sender', async () => {
    const w = await wireGame();
    for (const p of players) await hello(w, p.id as string, p.seat);

    await sendCamera(w, 'p1', { cx: 50, cy: 42, span: 24 });

    expect(cameraFrames(w, 'p1')).toHaveLength(0); // sender never echoes
    for (const pid of ['p2', 'p3']) {
      const frames = cameraFrames(w, pid);
      expect(frames, `${pid} received the relay`).toHaveLength(1);
      const moved = frames[0];
      if (moved?.event.case !== 'cameraMoved') throw new Error('unreachable');
      expect(moved.event.value.playerId).toBe('p1');
      expect(moved.event.value.view?.cx).toBeCloseTo(50);
      expect(moved.event.value.view?.span).toBeCloseTo(24);
    }
  });

  it('does not advance the authoritative game state (bypasses queue/engine/digest)', async () => {
    const w = await wireGame();
    for (const p of players) await hello(w, p.id as string, p.seat);
    const match = (w.hub as unknown as { registry: GameRegistry }).registry.get(gameId)!;
    const before = match.session.stateVersion;

    await sendCamera(w, 'p1', { cx: 10, cy: 10, span: 30 });

    expect(match.session.stateVersion).toBe(before);
  });

  it('replays the cached framing to a member who connects after the update', async () => {
    const w = await wireGame();
    await hello(w, 'p1', 0);
    await sendCamera(w, 'p1', { cx: 33, cy: 66, span: 18 });

    // p2 connects only now — it should immediately receive p1's cached view.
    await hello(w, 'p2', 1);
    const frames = cameraFrames(w, 'p2');
    expect(frames).toHaveLength(1);
    const moved = frames[0];
    if (moved?.event.case !== 'cameraMoved') throw new Error('unreachable');
    expect(moved.event.value.playerId).toBe('p1');
    expect(moved.event.value.view?.cy).toBeCloseTo(66);

    // The cached frame is never replayed back to its own author.
    await hello(w, 'p1', 0); // reconnect
    expect(cameraFrames(w, 'p1')).toHaveLength(0);
  });
});
