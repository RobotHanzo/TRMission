import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

let admin: { userId: string; token: string };
let moderator: { userId: string; token: string };

beforeAll(async () => {
  t = await createTestApp();
  const adminRes = await request(server())
    .post('/api/v1/auth/register')
    .send({ email: 'push-admin@example.com', password: 'password123', displayName: 'Admin' })
    .expect(201);
  admin = { userId: adminRes.body.user.id, token: adminRes.body.accessToken };
  await t.db.collection('dashboardAccounts').insertOne({
    _id: admin.userId,
    role: 'admin',
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);

  const modRes = await request(server())
    .post('/api/v1/auth/register')
    .send({ email: 'push-mod@example.com', password: 'password123', displayName: 'Mod' })
    .expect(201);
  moderator = { userId: modRes.body.user.id, token: modRes.body.accessToken };
  await t.db.collection('dashboardAccounts').insertOne({
    _id: moderator.userId,
    role: 'moderator',
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}, 60_000);

afterAll(() => t.close());

describe('dashboard push test-send', () => {
  it('403s a moderator on status and test (admin-tier permission)', async () => {
    await request(server()).get('/api/v1/dashboard/push/status').set(auth(moderator.token)).expect(403);
    await request(server())
      .post('/api/v1/dashboard/push/test')
      .set(auth(moderator.token))
      .send({ userId: 'whoever', kind: 'your_turn' })
      .expect(403);
  });

  it('status reports disabled with no transport credentials configured (test env)', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/push/status')
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.enabled).toBe(false);
  });

  it('reports {enabled:false, deviceCount:0} and still writes one push.test audit entry', async () => {
    const target = await guest('PushTarget');

    const res = await request(server())
      .post('/api/v1/dashboard/push/test')
      .set(auth(admin.token))
      .send({ userId: target.userId, kind: 'your_turn' })
      .expect(200);
    expect(res.body).toEqual({ enabled: false, deviceCount: 0, sent: 0, failed: 0 });

    const entries = await t.db
      .collection('dashboardAudit')
      .find({ action: 'push.test', 'target.id': target.userId } as never)
      .toArray();
    expect(entries).toHaveLength(1);
    expect((entries[0] as unknown as { actorId: string }).actorId).toBe(admin.userId);
    expect((entries[0] as unknown as { params: { kind: string } }).params.kind).toBe('your_turn');
  });

  it('400s an invalid kind', async () => {
    await request(server())
      .post('/api/v1/dashboard/push/test')
      .set(auth(admin.token))
      .send({ userId: 'whoever', kind: 'not_a_real_kind' })
      .expect(400);
  });
});
