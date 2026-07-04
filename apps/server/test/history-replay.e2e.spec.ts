import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { taiwanBoard, replay, stateDigest } from '@trm/engine';
import type { Board } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { storedToConfig, type GameDoc, type MatchHistoryDoc } from '../src/persistence/types';
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

  // Replay browsing is feature-gated; grant it so the member-access tests keep exercising
  // the granted path (direct db writes work on guests — only the dashboard API refuses
  // them). The gate matrix itself is tested in the last describe below.
  await t.db
    .collection('users')
    .updateMany({ _id: { $in: [host.id, member.id, watcher.id] } } as never, {
      $set: { features: ['replayReview'] },
    });
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

describe('GET /api/v1/history/:gameId/replay', () => {
  it('returns config + the full ordered action log; a pure replay reproduces finalDigest', async () => {
    const res = await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(host.token))
      .expect(200);
    expect(res.body.gameId).toBe(gameId);
    expect(res.body.engineVersion).toBeTypeOf('number');
    expect(res.body.schemaVersion).toBeTypeOf('number');
    expect(res.body.actions.length).toBeGreaterThan(0);
    expect(res.body.finalDigest).toBeTypeOf('string');
    const names = res.body.players.map((p: { displayName?: string }) => p.displayName);
    expect(names).toContain('Host');

    // Determinism seal: replaying the returned log reproduces the persisted final digest.
    const rep = replay(board, storedToConfig(res.body.config), res.body.actions);
    expect(rep.state.turn.phase).toBe('GAME_OVER');
    expect(stateDigest(rep.state)).toBe(res.body.finalDigest);
  });

  it('is allowed for spectators; 404 for non-members', async () => {
    await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(watcher.token))
      .expect(200);
    await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(outsider.token))
      .expect(404);
  });

  it('404 while a game is LIVE, even if an archive row exists (belt-and-braces)', async () => {
    const now = new Date();
    await t.db.collection<GameDoc>('games').insertOne({
      _id: 'live-1',
      seed: 's',
      config: { seed: 's', players: [{ id: host.id, seat: 0 }], contentHash: 'x' },
      engineVersion: 1,
      contentHash: 'x',
      schemaVersion: 1,
      status: 'LIVE',
      currentSeq: 0,
      createdAt: now,
      updatedAt: now,
    });
    await t.db.collection<MatchHistoryDoc>('matchHistory').insertOne({
      _id: 'live-1',
      players: [{ userId: host.id, seat: 0 }],
      turnOrder: [host.id],
      seed: 's',
      contentHash: 'x',
      finalScores: { players: [], ranking: [] },
      winners: [],
      completedAt: now,
    });
    await request(server()).get('/api/v1/history/live-1/replay').set(auth(host.token)).expect(404);
  });
});

describe('replay browsing requires replayReview', () => {
  const setFeatures = (userId: string, features: string[]) =>
    t.db.collection('users').updateOne({ _id: userId } as never, { $set: { features } });

  it('member without the feature: list/scoreboard OK, replay + visibility 403; link path stays open', async () => {
    await setFeatures(member.id, []);

    // History list + scoreboard stay open (spec: only the replay payload is gated).
    await request(server()).get('/api/v1/history').set(auth(member.token)).expect(200);
    await request(server()).get(`/api/v1/history/${gameId}`).set(auth(member.token)).expect(200);

    const denied = await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(member.token))
      .expect(403);
    expect(denied.body.code).toBe('FEATURE_DISABLED');

    // Sharing management is gated too.
    await request(server())
      .patch(`/api/v1/history/${gameId}/visibility`)
      .set(auth(member.token))
      .send({ visibility: 'link' })
      .expect(403);

    // Granted member: replay works and canConfigureVisibility is true.
    await setFeatures(member.id, ['replayReview']);
    const ok = await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(member.token))
      .expect(200);
    expect(ok.body.canConfigureVisibility).toBe(true);

    // Flip to link, revoke the feature: the member (and an anonymous visitor) can still
    // view via the link path; canConfigureVisibility drops to false.
    await request(server())
      .patch(`/api/v1/history/${gameId}/visibility`)
      .set(auth(member.token))
      .send({ visibility: 'link' })
      .expect(200);
    await setFeatures(member.id, []);
    const viaLink = await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(member.token))
      .expect(200);
    expect(viaLink.body.canConfigureVisibility).toBe(false);
    await request(server()).get(`/api/v1/history/${gameId}/replay`).expect(200); // anonymous

    // True outsider on a PRIVATE replay still gets the nondisclosing 404.
    await setFeatures(member.id, ['replayReview']);
    await request(server())
      .patch(`/api/v1/history/${gameId}/visibility`)
      .set(auth(member.token))
      .send({ visibility: 'private' })
      .expect(200);
    await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(outsider.token))
      .expect(404);
  });
});
