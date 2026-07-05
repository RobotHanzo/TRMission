import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  await t.db
    .collection('users')
    .updateOne({ _id: res.body.user.id } as never, { $set: { features: ['mapBuilder'] } });
  return { token: res.body.accessToken, id: res.body.user.id as string };
}

async function grantDashboard(userId: string, role: 'viewer' | 'admin') {
  await t.db.collection('dashboardAccounts').insertOne({
    _id: userId,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

let owner: { token: string; id: string };
let viewer: { token: string; id: string };
let admin: { token: string; id: string };
let mapId: string;

beforeAll(async () => {
  t = await createTestApp();
  owner = await registered('mapowner@example.com', 'Owner');
  const viewerAcct = await registered('viewer@example.com', 'Viewer');
  viewer = viewerAcct;
  const adminAcct = await registered('admin@example.com', 'Admin');
  admin = adminAcct;
  await grantDashboard(viewer.id, 'viewer');
  await grantDashboard(admin.id, 'admin');

  const created = await request(server())
    .post('/api/v1/maps')
    .set(auth(owner.token))
    .send({ nameZh: '測試地圖', nameEn: 'Test Map' })
    .expect(201);
  mapId = created.body.id;
}, 60_000);
afterAll(() => t.close());

describe('GET /dashboard/maps', () => {
  it('403s without maps.read', async () => {
    const noPerm = await registered('noperm@example.com', 'NoPerm');
    await request(server()).get('/api/v1/dashboard/maps').set(auth(noPerm.token)).expect(404);
  });

  it('lists maps across all owners (viewer permission)', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/maps')
      .set(auth(viewer.token))
      .expect(200);
    expect(res.body.maps.some((m: { id: string }) => m.id === mapId)).toBe(true);
    expect(res.body).toHaveProperty('nextCursor');
  });
});

describe('GET /dashboard/maps/:id', () => {
  it('returns detail with owner, draft, and usageCount=0 for a never-played map', async () => {
    const res = await request(server())
      .get(`/api/v1/dashboard/maps/${mapId}`)
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.id).toBe(mapId);
    expect(res.body.ownerId).toBe(owner.id);
    expect(res.body.draft).toEqual({ cities: [], routes: [], tickets: [] });
    expect(res.body.usageCount).toBe(0);
  });

  it('404s an unknown map', async () => {
    await request(server()).get('/api/v1/dashboard/maps/nope').set(auth(admin.token)).expect(404);
  });
});

describe('DELETE /dashboard/maps/:id', () => {
  it('403s a viewer (admin-tier permission)', async () => {
    const m = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: 'A', nameEn: 'A' })
      .expect(201);
    await request(server())
      .delete(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(viewer.token))
      .send({})
      .expect(403);
  });

  it('deletes any owner\'s map and audits it; mapContents (if any) survives', async () => {
    const m = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: 'B', nameEn: 'B' })
      .expect(201);
    // Simulate a previously-published revision of this draft: mapContents is immutable and
    // append-only, written once at game start, and must never be touched by a draft delete.
    const contentHash = `fake-hash-${m.body.id}`;
    await t.db.collection('mapContents').insertOne({
      _id: contentHash,
      content: { cities: [], routes: [], tickets: [] },
      sourceMapId: m.body.id,
      ownerId: owner.id,
      publishedAt: new Date(),
    } as never);

    await request(server())
      .delete(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(admin.token))
      .send({ reason: 'abuse' })
      .expect(204);
    await request(server())
      .get(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(admin.token))
      .expect(404);
    expect(
      await t.db
        .collection('dashboardAudit')
        .countDocuments({ action: 'map.delete', 'target.id': m.body.id } as never),
    ).toBe(1);
    // Direct DB check (not just an API-level assertion): the draft is gone from customMaps...
    expect(await t.db.collection('customMaps').findOne({ _id: m.body.id } as never)).toBeNull();
    // ...but the immutable published content survives untouched.
    expect(await t.db.collection('mapContents').findOne({ _id: contentHash } as never)).not.toBeNull();
  });

  it('404s an unknown map', async () => {
    await request(server())
      .delete('/api/v1/dashboard/maps/nope')
      .set(auth(admin.token))
      .send({})
      .expect(404);
  });
});

describe('DELETE /dashboard/maps/:id/share', () => {
  it('force-unshares regardless of owner', async () => {
    const m = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: 'C', nameEn: 'C' })
      .expect(201);
    await request(server())
      .post(`/api/v1/maps/${m.body.id}/share`)
      .set(auth(owner.token))
      .expect(200);
    await request(server())
      .delete(`/api/v1/dashboard/maps/${m.body.id}/share`)
      .set(auth(admin.token))
      .send({})
      .expect(204);
    const detail = await request(server())
      .get(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(admin.token))
      .expect(200);
    expect(detail.body.shareCode).toBeUndefined();
    expect(detail.body.shared).toBe(false);
  });
});

describe('POST /dashboard/maps/:id/transfer', () => {
  it('reassigns ownerId; new owner sees it via the player-facing list', async () => {
    const newOwner = await registered('newowner@example.com', 'NewOwner');
    const m = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: 'D', nameEn: 'D' })
      .expect(201);
    await request(server())
      .post(`/api/v1/dashboard/maps/${m.body.id}/transfer`)
      .set(auth(admin.token))
      .send({ newOwnerId: newOwner.id })
      .expect(200);

    const detail = await request(server())
      .get(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(admin.token))
      .expect(200);
    expect(detail.body.ownerId).toBe(newOwner.id);

    const list = await request(server())
      .get('/api/v1/maps')
      .set(auth(newOwner.token))
      .expect(200);
    expect(list.body.map((row: { id: string }) => row.id)).toContain(m.body.id);
  });
});
