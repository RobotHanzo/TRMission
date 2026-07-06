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

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-devices' });
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

describe('device registry', () => {
  it('registers a device token (idempotent upsert)', async () => {
    const u = await guest();
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ platform: 'android', token: 'fcm-tok-1' })
      .expect(204);
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ platform: 'android', token: 'fcm-tok-1' })
      .expect(204);
    const rows = await t.db.collection('userDevices').find({ userId: u.id }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe('fcm-tok-1');
    expect(rows[0]?.platform).toBe('android');
  });

  it('re-registering a token under another account moves it', async () => {
    const a = await guest();
    const b = await guest();
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ platform: 'ios', token: 'apns-tok-1' })
      .expect(204);
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ platform: 'ios', token: 'apns-tok-1' })
      .expect(204);
    const row = await t.db.collection('userDevices').findOne({ _id: 'apns-tok-1' as never });
    expect(row?.userId).toBe(b.id);
  });

  it('delete is scoped to the owning user', async () => {
    const a = await guest();
    const b = await guest();
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ platform: 'android', token: 'fcm-tok-2' })
      .expect(204);
    // B cannot remove A's token…
    await request(server())
      .delete('/api/v1/me/devices')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ token: 'fcm-tok-2' })
      .expect(204);
    expect(await t.db.collection('userDevices').countDocuments({ _id: 'fcm-tok-2' as never })).toBe(1);
    // …but A can.
    await request(server())
      .delete('/api/v1/me/devices')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ token: 'fcm-tok-2' })
      .expect(204);
    expect(await t.db.collection('userDevices').countDocuments({ _id: 'fcm-tok-2' as never })).toBe(0);
  });

  it('rejects unauthenticated and invalid bodies', async () => {
    await request(server())
      .post('/api/v1/me/devices')
      .send({ platform: 'android', token: 'x' })
      .expect(401);
    const u = await guest();
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ platform: 'windows', token: 'x' })
      .expect(400);
  });
});
