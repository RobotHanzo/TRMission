import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { taiwanBoard } from '@trm/engine';
import type { Board } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { actionToCommand, encodeClient, pickAction } from './helpers';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let host: { token: string; id: string };
let member: { token: string; id: string };
let watcher: { token: string; id: string };
let outsider: { token: string; id: string };
let gameId: string;
let board: Board;

beforeAll(async () => {
  t = await createTestApp();
  board = taiwanBoard();
  host = await guest('Host');
  member = await guest('Member');
  watcher = await guest('Watcher');
  outsider = await guest('Outsider');

  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({})
    .expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(member.token)).expect(200);
  for (const u of [host, member]) {
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(u.token))
      .send({ ready: true })
      .expect(200);
  }
  const started = await request(server())
    .post(`/api/v1/rooms/${code}/start`)
    .set(auth(host.token))
    .expect(200);
  gameId = started.body.gameId;
  const hostTicket: string = started.body.ticket;
  const memberTicket: string = (
    await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(member.token)).expect(200)
  ).body.ticket;

  const hub = t.app.get(GameHub);
  const seqs = new Map<string, number>();
  const nextSeq = (id: string): number => {
    const n = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, n);
    return n;
  };
  hub.openConnection('c-host', () => {});
  hub.openConnection('c-member', () => {});
  hub.openConnection('c-watch', () => {});
  await hub.receive(
    'c-host',
    encodeClient(nextSeq(host.id), {
      case: 'hello',
      value: { ticket: hostTicket, protocolVersion: 1 },
    }),
  );
  await hub.receive(
    'c-member',
    encodeClient(nextSeq(member.id), {
      case: 'hello',
      value: { ticket: memberTicket, protocolVersion: 1 },
    }),
  );
  // Mid-game spectator over the real REST + ws path.
  const spec = await request(server())
    .post(`/api/v1/rooms/${code}/spectate`)
    .set(auth(watcher.token))
    .expect(200);
  await hub.receive(
    'c-watch',
    encodeClient(1, { case: 'hello', value: { ticket: spec.body.ticket, protocolVersion: 1 } }),
  );

  // Drive to completion THROUGH the hub so every action is persisted like production.
  const match = t.app.get(GameRegistry).get(gameId);
  if (!match) throw new Error('match not registered');
  const connOf = new Map<string, string>([
    [host.id, 'c-host'],
    [member.id, 'c-member'],
  ]);
  let guard = 0;
  while (match.session.phase !== 'GAME_OVER') {
    if (++guard > 50_000) throw new Error('game did not terminate');
    const state = match.session.raw();
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? [host.id, member.id].map(asPlayerId).find((p) => match.session.hasPendingOffer(p))
        : match.session.currentPlayer;
    if (!actor) throw new Error(`no actor in ${state.turn.phase}`);
    await hub.receive(
      connOf.get(actor as string)!,
      encodeClient(nextSeq(actor as string), actionToCommand(pickAction(board, state, actor))),
    );
  }
  // Let the fire-and-forget spectator write + completion archive settle.
  await new Promise((r) => setTimeout(r, 50));
}, 180_000);
afterAll(() => t.close());

describe('GET /api/v1/history', () => {
  it('lists the finished game for a player: role, names, replayable', async () => {
    const res = await request(server()).get('/api/v1/history').set(auth(host.token)).expect(200);
    expect(res.body).toHaveLength(1);
    const row = res.body[0];
    expect(row.gameId).toBe(gameId);
    expect(row.role).toBe('player');
    expect(row.replayable).toBe(true);
    expect(row.winners.length).toBeGreaterThan(0);
    expect(typeof row.completedAt).toBe('string');
    const names = row.players.map((p: { displayName?: string }) => p.displayName);
    expect(names).toContain('Host');
    expect(names).toContain('Member');
  });

  it('lists the game for the spectator with role=spectator', async () => {
    const res = await request(server()).get('/api/v1/history').set(auth(watcher.token)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].role).toBe('spectator');
  });

  it('is empty for a non-member', async () => {
    const res = await request(server())
      .get('/api/v1/history')
      .set(auth(outsider.token))
      .expect(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/v1/history/:gameId', () => {
  it('200 for member and spectator; 404 for non-member; 401 unauthenticated', async () => {
    await request(server()).get(`/api/v1/history/${gameId}`).set(auth(member.token)).expect(200);
    await request(server()).get(`/api/v1/history/${gameId}`).set(auth(watcher.token)).expect(200);
    await request(server()).get(`/api/v1/history/${gameId}`).set(auth(outsider.token)).expect(404);
    await request(server()).get(`/api/v1/history/${gameId}`).expect(401);
  });
});
