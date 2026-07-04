// Replay visibility: a finished game's replay is 'private' (members only — the legacy
// behaviour) until any seated player flips it to 'link' (anyone with the URL, even
// unauthenticated). Spectators can watch but never configure. Docs are seeded directly —
// the guard logic is what's under test; the full drive-a-game path is covered by
// history-replay.e2e.spec.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import type { GameDoc, MatchHistoryDoc } from '../src/persistence/types';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let playerA: { token: string; id: string };
let playerB: { token: string; id: string };
let watcher: { token: string; id: string };
let outsider: { token: string; id: string };
const gameId = 'g-vis';

beforeAll(async () => {
  t = await createTestApp();
  playerA = await guest('PlayerA');
  playerB = await guest('PlayerB');
  watcher = await guest('Watcher');
  outsider = await guest('Outsider');

  // Member replay access + visibility management require the replayReview feature; grant
  // it so this suite keeps testing the visibility rules themselves (the feature-gate matrix
  // lives in history-replay.e2e.spec.ts).
  await t.db
    .collection('users')
    .updateMany({ _id: { $in: [playerA.id, playerB.id, watcher.id] } } as never, {
      $set: { features: ['replayReview'] },
    });

  const now = new Date();
  await t.db.collection<GameDoc>('games').insertOne({
    _id: gameId,
    seed: 's',
    config: {
      seed: 's',
      players: [
        { id: playerA.id, seat: 0 },
        { id: playerB.id, seat: 1 },
      ],
      contentHash: 'x',
    },
    engineVersion: 1,
    contentHash: 'x',
    schemaVersion: 1,
    status: 'COMPLETED',
    currentSeq: 0,
    createdAt: now,
    updatedAt: now,
  });
  await t.db.collection<MatchHistoryDoc>('matchHistory').insertOne({
    _id: gameId,
    players: [
      { userId: playerA.id, seat: 0 },
      { userId: playerB.id, seat: 1 },
    ],
    turnOrder: [playerA.id, playerB.id],
    seed: 's',
    contentHash: 'x',
    finalScores: { players: [], ranking: [] } as unknown as MatchHistoryDoc['finalScores'],
    winners: [playerA.id],
    spectators: [watcher.id],
    completedAt: now,
  });
});
afterAll(() => t.close());

const replayPath = `/api/v1/history/${gameId}/replay`;
const visibilityPath = `/api/v1/history/${gameId}/visibility`;

describe('default (legacy) visibility: private', () => {
  it('members still get the replay; payload reports visibility + who may configure', async () => {
    const asPlayer = await request(server()).get(replayPath).set(auth(playerA.token)).expect(200);
    expect(asPlayer.body.visibility).toBe('private');
    expect(asPlayer.body.canConfigureVisibility).toBe(true);
    const asWatcher = await request(server()).get(replayPath).set(auth(watcher.token)).expect(200);
    expect(asWatcher.body.canConfigureVisibility).toBe(false);
  });

  it('404 for outsiders and for anonymous visitors (nondisclosure)', async () => {
    await request(server()).get(replayPath).set(auth(outsider.token)).expect(404);
    await request(server()).get(replayPath).expect(404);
  });

  it('a present-but-invalid token still 401s (feeds the client refresh path)', async () => {
    await request(server()).get(replayPath).set(auth('garbage')).expect(401);
  });
});

describe('PATCH /api/v1/history/:gameId/visibility', () => {
  it('any seated player may configure; spectators/outsiders get 404; anonymous 401', async () => {
    await request(server())
      .patch(visibilityPath)
      .set(auth(watcher.token))
      .send({ visibility: 'link' })
      .expect(404);
    await request(server())
      .patch(visibilityPath)
      .set(auth(outsider.token))
      .send({ visibility: 'link' })
      .expect(404);
    await request(server()).patch(visibilityPath).send({ visibility: 'link' }).expect(401);

    const res = await request(server())
      .patch(visibilityPath)
      .set(auth(playerB.token))
      .send({ visibility: 'link' })
      .expect(200);
    expect(res.body.visibility).toBe('link');
  });

  it('rejects junk values', async () => {
    await request(server())
      .patch(visibilityPath)
      .set(auth(playerA.token))
      .send({ visibility: 'PUBLIC' })
      .expect(400);
  });
});

describe('view-by-link', () => {
  it('anyone with the URL can fetch the replay, even unauthenticated', async () => {
    const anon = await request(server()).get(replayPath).expect(200);
    expect(anon.body.visibility).toBe('link');
    expect(anon.body.canConfigureVisibility).toBe(false);
    const asOutsider = await request(server())
      .get(replayPath)
      .set(auth(outsider.token))
      .expect(200);
    expect(asOutsider.body.canConfigureVisibility).toBe(false);
  });

  it('flipping back to private locks it down again', async () => {
    await request(server())
      .patch(visibilityPath)
      .set(auth(playerA.token))
      .send({ visibility: 'private' })
      .expect(200);
    await request(server()).get(replayPath).expect(404);
    await request(server()).get(replayPath).set(auth(outsider.token)).expect(404);
    // Members are unaffected.
    await request(server()).get(replayPath).set(auth(playerB.token)).expect(200);
  });

  it('unknown game ids 404 for everyone (no existence disclosure)', async () => {
    await request(server()).get('/api/v1/history/nope/replay').expect(404);
    await request(server())
      .patch('/api/v1/history/nope/visibility')
      .set(auth(playerA.token))
      .send({ visibility: 'link' })
      .expect(404);
  });
});
