import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { RATING_TEXT_MAX_LEN } from '../src/ratings/ratings.schemas';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('POST /ratings', () => {
  it('persists a star rating tagged with gameId/roomId/userId', async () => {
    const player = await guest('Rater');
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

  it('allows a second, independent rating for the same game (append-only, never overwrites)', async () => {
    const player = await guest('Rater3');
    await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g2', roomId: 'FGHIJ', stars: 3 })
      .expect(201);
    await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g2', roomId: 'FGHIJ', stars: 5 })
      .expect(201);
    const count = await t.db
      .collection('gameRatings')
      .countDocuments({ userId: player.id, gameId: 'g2' } as never);
    expect(count).toBe(2);
  });

  it('401s without a token', async () => {
    await request(server())
      .post('/api/v1/ratings')
      .send({ gameId: 'g1', roomId: 'ABCDE', stars: 5 })
      .expect(401);
  });
});
