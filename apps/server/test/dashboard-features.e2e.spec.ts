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
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

let owner: Awaited<ReturnType<typeof registered>>;
let moderator: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  owner = await registered('owner@example.com', 'Owner');
  moderator = await registered('mod@example.com', 'Mod');
  const now = new Date();
  await t.db.collection('dashboardAccounts').insertMany([
    { _id: owner.userId, role: 'owner', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: moderator.userId, role: 'moderator', grantedBy: 'test', grantedAt: now, updatedAt: now },
  ] as never[]);
}, 60_000);
afterAll(() => t.close());

describe('dashboard feature grants', () => {
  it('grant → detail/list reflect it → revoke; audited; guests 400; moderators 403', async () => {
    const alice = await registered('alice@example.com', 'Alice');

    // Grant both features.
    const granted = await request(server())
      .put(`/api/v1/dashboard/users/${alice.userId}/features`)
      .set(auth(owner.token))
      .send({ features: ['replayReview', 'mapBuilder'] })
      .expect(200);
    expect(granted.body.features).toEqual(['replayReview', 'mapBuilder']);

    // The featured list contains alice.
    const list = await request(server())
      .get('/api/v1/dashboard/users/features')
      .set(auth(owner.token))
      .expect(200);
    expect(list.body.users.map((u: { id: string }) => u.id)).toContain(alice.userId);

    // The gate actually opens (feature is live on the game surface).
    await request(server()).get('/api/v1/maps').set(auth(alice.token)).expect(200);

    // Revoke-all unsets the field and empties the list entry.
    const revoked = await request(server())
      .put(`/api/v1/dashboard/users/${alice.userId}/features`)
      .set(auth(owner.token))
      .send({ features: [] })
      .expect(200);
    expect(revoked.body.features).toEqual([]);
    const after = await request(server())
      .get('/api/v1/dashboard/users/features')
      .set(auth(owner.token))
      .expect(200);
    expect(after.body.users.map((u: { id: string }) => u.id)).not.toContain(alice.userId);

    // Audit entries were appended.
    const audit = await request(server())
      .get('/api/v1/dashboard/audit')
      .set(auth(owner.token))
      .expect(200);
    const entries = audit.body.entries.filter(
      (e: { action: string; target?: { id: string } }) =>
        e.action === 'user.features' && e.target?.id === alice.userId,
    );
    expect(entries.length).toBe(2);

    // Guests can never hold features.
    const g = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'G' })
      .expect(201);
    await request(server())
      .put(`/api/v1/dashboard/users/${g.body.user.id}/features`)
      .set(auth(owner.token))
      .send({ features: ['mapBuilder'] })
      .expect(400);

    // users.features is admin+ — a moderator is 403.
    await request(server())
      .put(`/api/v1/dashboard/users/${alice.userId}/features`)
      .set(auth(moderator.token))
      .send({ features: ['mapBuilder'] })
      .expect(403);
    await request(server())
      .get('/api/v1/dashboard/users/features')
      .set(auth(moderator.token))
      .expect(403);

    // Unknown feature name is rejected by validation.
    await request(server())
      .put(`/api/v1/dashboard/users/${alice.userId}/features`)
      .set(auth(owner.token))
      .send({ features: ['timeTravel'] })
      .expect(400);
  });
});
