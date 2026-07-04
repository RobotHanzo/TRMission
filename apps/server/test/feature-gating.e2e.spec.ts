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

describe('lobby: hosting a custom map requires mapBuilder', () => {
  it('blocks select and start for a non-granted host; official maps unaffected', async () => {
    const host = await registered('feat-host@example.com', 'FeatHost');
    await grant(t.db, host.id, ['mapBuilder']);

    // Author a map while granted (an empty draft is enough — the gate fires before validation).
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(host.token))
      .send({ nameZh: '圖', nameEn: 'Map' })
      .expect(201);
    const mapId: string = created.body.id;

    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    // Revoke, then try to SELECT the custom map → 403 FEATURE_DISABLED.
    await grant(t.db, host.id, []);
    const sel = await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ map: { source: 'custom', customMapId: mapId } })
      .expect(403);
    expect(sel.body.code).toBe('FEATURE_DISABLED');

    // Re-grant, select, revoke again: START must still be blocked (authoritative check).
    // Fill the room to 2 ready players first so the ONLY failure left is the feature gate
    // (the check lives in resolveMapForStart's custom branch, which runs before draft validation).
    await grant(t.db, host.id, ['mapBuilder']);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ map: { source: 'custom', customMapId: mapId } })
      .expect(200);
    const buddy = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Buddy' })
      .expect(201);
    await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(buddy.body.accessToken))
      .expect(200);
    for (const token of [host.token, buddy.body.accessToken as string]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(token))
        .send({ ready: true })
        .expect(200);
    }
    await grant(t.db, host.id, []);
    const start = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(403);
    expect(start.body.code).toBe('FEATURE_DISABLED');

    // Official maps stay selectable without any feature.
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ map: { source: 'official', mapId: 'taiwan' } })
      .expect(200);
  });
});
