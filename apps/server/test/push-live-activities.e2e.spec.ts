import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-live-activities' });
}, 60_000);
afterAll(() => t.close());

const guest = async () => {
  const res = await request(server())
    .post('/api/v1/auth/guest')
    .set('x-trm-client', 'mobile')
    .send({})
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
};

/** An ActivityKit push token is hex, and longer than an APNs device token. */
const activityToken = (tag: string): string =>
  (
    Array.from(tag)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('') + 'b'.repeat(160)
  ).slice(0, 160);

const rows = (userId: string) => t.db.collection('liveActivities').find({ userId }).toArray();

describe('live activity registry (issue #43)', () => {
  it('registers an activity token for a game (idempotent upsert)', async () => {
    const u = await guest();
    const gameId = randomUUID();
    const token = activityToken('act1');
    for (const _ of [1, 2]) {
      await request(server())
        .post('/api/v1/me/live-activities')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ gameId, token })
        .expect(204);
    }
    const found = await rows(u.id);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ _id: token, gameId });
  });

  it('re-registering the same token moves it to the new game (a device plays one game at a time)', async () => {
    const u = await guest();
    const token = activityToken('act2');
    const first = randomUUID();
    const second = randomUUID();
    for (const gameId of [first, second]) {
      await request(server())
        .post('/api/v1/me/live-activities')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ gameId, token })
        .expect(204);
    }
    const found = await rows(u.id);
    expect(found).toHaveLength(1);
    expect(found[0]?.gameId).toBe(second);
  });

  it('delete is scoped to the owning user', async () => {
    const a = await guest();
    const b = await guest();
    const gameId = randomUUID();
    const token = activityToken('act3');
    await request(server())
      .post('/api/v1/me/live-activities')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ gameId, token })
      .expect(204);
    await request(server())
      .delete('/api/v1/me/live-activities')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ token })
      .expect(204);
    expect(await rows(a.id)).toHaveLength(1);
    await request(server())
      .delete('/api/v1/me/live-activities')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ token })
      .expect(204);
    expect(await rows(a.id)).toHaveLength(0);
  });

  it('rejects unauthenticated calls, a malformed game id, and injection-shaped tokens', async () => {
    await request(server())
      .post('/api/v1/me/live-activities')
      .send({ gameId: randomUUID(), token: activityToken('x') })
      .expect(401);

    const u = await guest();
    // Game ids are UUIDs; anything else never reaches a row.
    await request(server())
      .post('/api/v1/me/live-activities')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ gameId: 'not-a-uuid', token: activityToken('x') })
      .expect(400);
    // The token is spliced into the outbound APNs :path — dot-segments and non-hex are refused.
    await request(server())
      .post('/api/v1/me/live-activities')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ gameId: randomUUID(), token: '../../1/apps/com.example.app' })
      .expect(400);
    await request(server())
      .post('/api/v1/me/live-activities')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ gameId: randomUUID(), token: 'z'.repeat(160) })
      .expect(400);
    expect(await rows(u.id)).toHaveLength(0);
  });
});
