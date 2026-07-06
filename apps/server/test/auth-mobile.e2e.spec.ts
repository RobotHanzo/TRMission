import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, refreshCookie, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-mobile' });
}, 60_000);
afterAll(() => t.close());

describe('guest TTL: refresh slides guestExpiresAt forward', () => {
  it('extends an almost-expired guest on refresh', async () => {
    const guest = await request(server()).post('/api/v1/auth/guest').send({}).expect(201);
    const id = guest.body.user.id as string;

    // Backdate the TTL anchor to nearly-now, as if the guest were 30 days old.
    await t.db
      .collection('users')
      .updateOne({ _id: id as never }, { $set: { guestExpiresAt: new Date(Date.now() + 1000) } });

    await request(server())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(guest))
      .expect(200);

    const doc = await t.db.collection('users').findOne({ _id: id as never });
    const twentyDays = 20 * 24 * 60 * 60 * 1000;
    expect((doc?.guestExpiresAt as Date).getTime()).toBeGreaterThan(Date.now() + twentyDays);
  });
});
