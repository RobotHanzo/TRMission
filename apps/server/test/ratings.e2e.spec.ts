import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { RATING_TEXT_MAX_LEN } from '../src/ratings/ratings.schemas';
import type { MatchHistoryDoc } from '../src/persistence/types';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

/** Seeds a finished game's archive directly (mirrors how the game store writes it on
 *  completion) — a rating is only accepted for a game the caller actually played or
 *  spectated, and `matchHistory` is the membership record that check consults. */
async function seedCompletedGame(
  gameId: string,
  players: { userId: string; seat: number }[],
  spectators: string[] = [],
): Promise<void> {
  await t.db.collection<MatchHistoryDoc>('matchHistory').insertOne({
    _id: gameId,
    players,
    turnOrder: players.map((p) => p.userId),
    seed: 's',
    contentHash: 'x',
    finalScores: {
      players: players.map((p) => ({ playerId: p.userId, total: 0 })),
      ranking: [players.map((p) => p.userId)],
    } as unknown as MatchHistoryDoc['finalScores'],
    winners: [players[0]!.userId],
    ...(spectators.length ? { spectators } : {}),
    completedAt: new Date(),
  });
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('POST /ratings', () => {
  it('persists a star rating tagged with gameId/roomId/userId for a seated player', async () => {
    const player = await guest('Rater');
    await seedCompletedGame('g1', [{ userId: player.id, seat: 0 }]);
    const res = await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g1', roomId: 'ABCDE', stars: 5 })
      .expect(201);
    expect(res.body.stars).toBe(5);
    expect(res.body.id).toBeTruthy();
    expect(res.body.createdAt).toBeTruthy();

    const doc = await t.db.collection('gameRatings').findOne({ _id: res.body.id } as never);
    expect(doc).toMatchObject({ userId: player.id, gameId: 'g1', roomId: 'ABCDE', stars: 5 });
  });

  it('persists optional feedback text, trimmed', async () => {
    const player = await guest('Rater4');
    await seedCompletedGame('g4', [{ userId: player.id, seat: 0 }]);
    const res = await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g4', roomId: 'KLMNO', stars: 4, text: '  Great game!  ' })
      .expect(201);
    expect(res.body.text).toBe('Great game!');

    const doc = await t.db.collection('gameRatings').findOne({ _id: res.body.id } as never);
    expect(doc).toMatchObject({ text: 'Great game!' });
  });

  it('rejects feedback text over the length limit', async () => {
    const player = await guest('Rater5');
    await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g5', roomId: 'PQRST', stars: 3, text: 'x'.repeat(RATING_TEXT_MAX_LEN + 1) })
      .expect(400);
  });

  it('rejects an out-of-range stars value', async () => {
    const player = await guest('Rater2');
    await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g1', roomId: 'ABCDE', stars: 6 })
      .expect(400);
  });

  it('rejects a rating for a game the caller never played or spectated (404, nondisclosing)', async () => {
    const player = await guest('Member6');
    const outsider = await guest('Outsider6');
    await seedCompletedGame('g6', [{ userId: player.id, seat: 0 }]);
    await request(server())
      .post('/api/v1/ratings')
      .set(auth(outsider.token))
      .send({ gameId: 'g6', roomId: 'UVWXY', stars: 1, text: 'never played this' })
      .expect(404);

    const count = await t.db
      .collection('gameRatings')
      .countDocuments({ userId: outsider.id } as never);
    expect(count).toBe(0);
  });

  it('rejects a rating for a gameId that was never archived (LIVE or unknown)', async () => {
    const player = await guest('Rater7');
    await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'not-a-real-game', roomId: 'ZABCD', stars: 2 })
      .expect(404);
  });

  it('allows a recorded spectator of the game to submit a rating too', async () => {
    const player = await guest('Player8');
    const spectator = await guest('Spectator8');
    await seedCompletedGame('g8', [{ userId: player.id, seat: 0 }], [spectator.id]);
    const res = await request(server())
      .post('/api/v1/ratings')
      .set(auth(spectator.token))
      .send({ gameId: 'g8', roomId: 'EFGHI', stars: 4 })
      .expect(201);
    expect(res.body.stars).toBe(4);
  });

  it('a resubmission for the same game updates the existing rating instead of duplicating it', async () => {
    const player = await guest('Rater3');
    await seedCompletedGame('g2', [{ userId: player.id, seat: 0 }]);
    const first = await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g2', roomId: 'FGHIJ', stars: 3 })
      .expect(201);
    const second = await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g2', roomId: 'FGHIJ', stars: 5 })
      .expect(201);
    // Same underlying row (created once, then updated) — not a fresh id per submission.
    expect(second.body.id).toBe(first.body.id);

    const docs = await t.db
      .collection('gameRatings')
      .find({ userId: player.id, gameId: 'g2' } as never)
      .toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.stars).toBe(5);
  });

  it('401s without a token', async () => {
    await request(server())
      .post('/api/v1/ratings')
      .send({ gameId: 'g1', roomId: 'ABCDE', stars: 5 })
      .expect(401);
  });
});
