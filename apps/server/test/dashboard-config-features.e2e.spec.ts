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
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

let owner: Awaited<ReturnType<typeof registered>>;
let admin: Awaited<ReturnType<typeof registered>>;
let moderator: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  owner = await registered('cfg-owner@example.com', 'Owner');
  admin = await registered('cfg-admin@example.com', 'Admin');
  moderator = await registered('cfg-mod@example.com', 'Mod');
  const now = new Date();
  await t.db.collection('dashboardAccounts').insertMany([
    { _id: owner.id, role: 'owner', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: admin.id, role: 'admin', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: moderator.id, role: 'moderator', grantedBy: 'test', grantedAt: now, updatedAt: now },
  ] as never[]);
}, 60_000);
afterAll(() => t.close());

describe('dashboard config: default feature flags', () => {
  it('starts at the code fallback, round-trips a PUT, is audited, and is permission-gated', async () => {
    // Fresh install: the fallback default (randomEvents) shows up before any admin ever saves.
    const initial = await request(server())
      .get('/api/v1/dashboard/config/features')
      .set(auth(owner.token))
      .expect(200);
    expect(initial.body.features).toEqual(['randomEvents']);

    // config.features is a distinct permission from users.features — a moderator has neither.
    await request(server())
      .get('/api/v1/dashboard/config/features')
      .set(auth(moderator.token))
      .expect(403);
    await request(server())
      .put('/api/v1/dashboard/config/features')
      .set(auth(moderator.token))
      .send({ features: [] })
      .expect(403);

    // Admin can change it; the change round-trips and dedupes.
    const put = await request(server())
      .put('/api/v1/dashboard/config/features')
      .set(auth(admin.token))
      .send({ features: ['mapBuilder', 'mapBuilder', 'replayReview'] })
      .expect(200);
    expect(put.body.features).toEqual(['mapBuilder', 'replayReview']);

    const after = await request(server())
      .get('/api/v1/dashboard/config/features')
      .set(auth(owner.token))
      .expect(200);
    expect(after.body.features).toEqual(['mapBuilder', 'replayReview']);

    // The new default actually opens a feature-gated route for an account with no explicit grant.
    const bystander = await registered('cfg-bystander@example.com', 'Bystander');
    await request(server()).get('/api/v1/maps').set(auth(bystander.token)).expect(200);

    // Audited with before/after.
    const audit = await request(server())
      .get('/api/v1/dashboard/audit')
      .set(auth(owner.token))
      .expect(200);
    const entry = audit.body.entries.find(
      (e: { action: string }) => e.action === 'config.features',
    );
    expect(entry).toBeDefined();
    expect(entry.params).toEqual({
      before: ['randomEvents'],
      after: ['mapBuilder', 'replayReview'],
    });

    // Unknown feature name is rejected by validation.
    await request(server())
      .put('/api/v1/dashboard/config/features')
      .set(auth(admin.token))
      .send({ features: ['timeTravel'] })
      .expect(400);
  });
});
