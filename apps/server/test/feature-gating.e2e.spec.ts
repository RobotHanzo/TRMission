import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { UserFeature } from '@trm/shared';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

/** Grant features directly in Mongo — the dashboard API arrives in a later task. */
async function grant(db: TestApp['db'], userId: string, features: UserFeature[]) {
  await db.collection('users').updateOne({ _id: userId } as never, { $set: { features } });
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('PublicUser.features', () => {
  it('defaults to [] and reflects grants instantly (no re-login)', async () => {
    const a = await registered('feat-me@example.com', 'FeatMe');
    const before = await request(server()).get('/api/v1/auth/me').set(auth(a.token)).expect(200);
    expect(before.body.features).toEqual([]);

    await grant(t.db, a.id, ['mapBuilder']);
    const after = await request(server()).get('/api/v1/auth/me').set(auth(a.token)).expect(200);
    expect(after.body.features).toEqual(['mapBuilder']);
  });
});

describe('maps routes require mapBuilder', () => {
  it('403 FEATURE_DISABLED without the feature; works with it; content/:hash stays open', async () => {
    const a = await registered('feat-maps@example.com', 'FeatMaps');

    const denied = await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(403);
    expect(denied.body.code).toBe('FEATURE_DISABLED');
    await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '圖', nameEn: 'Map' })
      .expect(403);
    await request(server()).get('/api/v1/maps/shared/ABCD1234').set(auth(a.token)).expect(403);

    await grant(t.db, a.id, ['mapBuilder']);
    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(200);
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '圖', nameEn: 'Map' })
      .expect(201);
    expect(created.body.id).toBeTruthy();

    // content/:hash is NOT feature-gated — any authenticated user (even a guest) may resolve it.
    const g = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Guest' })
      .expect(201);
    await request(server())
      .get('/api/v1/maps/content/no-such-hash')
      .set(auth(g.body.accessToken))
      .expect(404); // 404 (unknown hash), NOT 403 — proves the route is reachable
  });
});
