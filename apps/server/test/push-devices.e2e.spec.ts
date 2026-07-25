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

// Well-formed platform tokens, matching the shapes RegisterDeviceSchema now enforces.
// (An APNs device token is hex-only, so `tag` is hex-encoded rather than used verbatim.)
const iosToken = (tag: string): string => {
  const hex = Array.from(tag)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  return (hex + 'a'.repeat(64)).slice(0, 64);
};
const androidToken = (tag: string): string => `fcm_${tag}_${'a'.repeat(20)}`;

describe('device registry', () => {
  it('registers a device token (idempotent upsert)', async () => {
    const u = await guest();
    const token = androidToken('tok1');
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ platform: 'android', token })
      .expect(204);
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ platform: 'android', token })
      .expect(204);
    const rows = await t.db.collection('userDevices').find({ userId: u.id }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe(token);
    expect(rows[0]?.platform).toBe('android');
  });

  it('re-registering a token under another account moves it', async () => {
    const a = await guest();
    const b = await guest();
    const token = iosToken('apnstok1');
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ platform: 'ios', token })
      .expect(204);
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ platform: 'ios', token })
      .expect(204);
    const row = await t.db.collection('userDevices').findOne({ _id: token as never });
    expect(row?.userId).toBe(b.id);
  });

  it('delete is scoped to the owning user', async () => {
    const a = await guest();
    const b = await guest();
    const token = androidToken('tok2');
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ platform: 'android', token })
      .expect(204);
    // B cannot remove A's token…
    await request(server())
      .delete('/api/v1/me/devices')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ token })
      .expect(204);
    expect(await t.db.collection('userDevices').countDocuments({ _id: token as never })).toBe(1);
    // …but A can.
    await request(server())
      .delete('/api/v1/me/devices')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ token })
      .expect(204);
    expect(await t.db.collection('userDevices').countDocuments({ _id: token as never })).toBe(0);
  });

  it('rejects unauthenticated and invalid bodies', async () => {
    await request(server())
      .post('/api/v1/me/devices')
      .send({ platform: 'android', token: androidToken('x') })
      .expect(401);
    const u = await guest();
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ platform: 'windows', token: androidToken('x') })
      .expect(400);
  });

  it('rejects a token shaped for request-line injection (path traversal / bad charset)', async () => {
    const u = await guest();
    // The exploit shape from the finding: dot-segments that would splice into the APNs
    // HTTP/2 :path pseudo-header past /3/device/.
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ platform: 'ios', token: '../../1/apps/com.example.app' })
      .expect(400);
    // Right length, wrong charset (non-hex) for an iOS APNs token.
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ platform: 'ios', token: 'z'.repeat(64) })
      .expect(400);
    // Android/FCM tokens never contain '/' or '.'.
    await request(server())
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ platform: 'android', token: '../../../etc/passwd' })
      .expect(400);
    expect(await t.db.collection('userDevices').countDocuments({ userId: u.id })).toBe(0);
  });
});
