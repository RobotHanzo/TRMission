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
let viewer: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  owner = await registered('owner@example.com', 'Owner');
  moderator = await registered('mod@example.com', 'Mod');
  viewer = await registered('viewer@example.com', 'Viewer');
  const now = new Date();
  await t.db.collection('dashboardAccounts').insertMany([
    { _id: owner.userId, role: 'owner', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: moderator.userId, role: 'moderator', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: viewer.userId, role: 'viewer', grantedBy: 'test', grantedAt: now, updatedAt: now },
  ] as never[]);
}, 60_000);
afterAll(() => t.close());

describe('dashboard tutorial-completed reset', () => {
  it('shows true after self-completion, resets to false (moderator+), audited; viewer 403', async () => {
    const alice = await registered('alice@example.com', 'Alice');
    await request(server())
      .post('/api/v1/auth/me/tutorial-completed')
      .set(auth(alice.token))
      .expect(200);

    const before = await request(server())
      .get(`/api/v1/dashboard/users/${alice.userId}`)
      .set(auth(owner.token))
      .expect(200);
    expect(before.body.tutorialCompleted).toBe(true);

    // A viewer cannot reset it.
    await request(server())
      .post(`/api/v1/dashboard/users/${alice.userId}/tutorial-reset`)
      .set(auth(viewer.token))
      .expect(403);

    // A moderator can.
    const reset = await request(server())
      .post(`/api/v1/dashboard/users/${alice.userId}/tutorial-reset`)
      .set(auth(moderator.token))
      .expect(200);
    expect(reset.body.tutorialCompleted).toBe(false);

    // Reflected in the list row too.
    const list = await request(server())
      .get('/api/v1/dashboard/users?filter=all')
      .set(auth(owner.token))
      .expect(200);
    const row = list.body.users.find((u: { id: string }) => u.id === alice.userId);
    expect(row.tutorialCompleted).toBe(false);

    // Audited.
    const audit = await request(server())
      .get('/api/v1/dashboard/audit')
      .set(auth(owner.token))
      .expect(200);
    const entry = audit.body.entries.find(
      (e: { action: string; target?: { id: string } }) =>
        e.action === 'user.tutorialReset' && e.target?.id === alice.userId,
    );
    expect(entry).toBeTruthy();
  });
});
