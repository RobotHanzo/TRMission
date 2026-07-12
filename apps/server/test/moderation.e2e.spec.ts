import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-moderation' });
}, 60_000);
afterAll(() => t.close());

describe('blocks: the client-side mute list', () => {
  it('starts empty, adds idempotently, lists, and removes', async () => {
    const a = await guest('Blocker');
    const b = await guest('Loudmouth');

    const empty = await request(server()).get('/api/v1/me/blocks').set(auth(a.token)).expect(200);
    expect(empty.body).toEqual({ blockedUserIds: [] });

    await request(server()).put(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(204);
    // Idempotent: re-blocking is a no-op success, not an error.
    await request(server()).put(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(204);

    const one = await request(server()).get('/api/v1/me/blocks').set(auth(a.token)).expect(200);
    expect(one.body.blockedUserIds).toEqual([b.userId]);

    await request(server()).delete(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(204);
    const gone = await request(server()).get('/api/v1/me/blocks').set(auth(a.token)).expect(200);
    expect(gone.body.blockedUserIds).toEqual([]);
  });

  it('rejects blocking yourself (400) and unknown users (404); requires auth (401)', async () => {
    const a = await guest('Selfish');
    await request(server()).put(`/api/v1/me/blocks/${a.userId}`).set(auth(a.token)).expect(400);
    await request(server()).put('/api/v1/me/blocks/no-such-user').set(auth(a.token)).expect(404);
    await request(server()).get('/api/v1/me/blocks').expect(401);
  });

  it('409s when the list is full (cap 500)', async () => {
    const a = await guest('Collector');
    const b = await guest('OneMore');
    await t.db
      .collection('users')
      .updateOne(
        { _id: a.userId as never },
        { $set: { blockedUserIds: Array.from({ length: 500 }, (_, i) => `padding-${i}`) } },
      );
    await request(server()).put(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(409);
  });
});
