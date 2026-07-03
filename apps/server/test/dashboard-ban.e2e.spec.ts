import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, refreshCookie, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return {
    userId: res.body.user.id as string,
    token: res.body.accessToken as string,
    cookie: refreshCookie(res),
  };
}

let moderator: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  moderator = await registered('mod@example.com', 'Mod');
  await t.db.collection('dashboardAccounts').insertOne({
    _id: moderator.userId,
    role: 'moderator',
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}, 60_000);

afterAll(() => t.close());

describe('ban enforcement', () => {
  it('bans an account: sessions die, logins/refresh/tickets refused; unban restores', async () => {
    const victim = await registered('victim@example.com', 'Vic');

    // The victim is host of a started game (for the ws-ticket path).
    const other = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Other' })
      .expect(201);
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(victim.token))
      .send({})
      .expect(201);
    const code = room.body.code;
    await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(other.body.accessToken))
      .expect(200);
    for (const tok of [victim.token, other.body.accessToken]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(tok))
        .send({ ready: true })
        .expect(200);
    }
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(victim.token)).expect(200);
    // Sanity: ticket works pre-ban.
    await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(victim.token)).expect(200);

    // Ban.
    const banned = await request(server())
      .post(`/api/v1/dashboard/users/${victim.userId}/disable`)
      .set(auth(moderator.token))
      .send({ reason: 'griefing' })
      .expect(200);
    expect(banned.body.disabledAt).toBeTruthy();
    expect(banned.body.disabledReason).toBe('griefing');

    // New login refused (403), refresh with the pre-ban cookie dead (401).
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'victim@example.com', password: 'password123' })
      .expect(403);
    await request(server())
      .post('/api/v1/auth/refresh')
      .set('Cookie', victim.cookie)
      .expect(401);

    // ws-game ticket refused for the banned member.
    await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(victim.token)).expect(403);
    await request(server())
      .post(`/api/v1/rooms/${code}/spectate`)
      .set(auth(victim.token))
      .expect(403);

    // The documented ≤15-min window: the stale access token still reads /auth/me.
    await request(server()).get('/api/v1/auth/me').set(auth(victim.token)).expect(200);

    // Audit trail exists.
    expect(
      await t.db.collection('dashboardAudit').countDocuments({
        action: 'user.ban',
        'target.id': victim.userId,
      } as never),
    ).toBe(1);

    // Unban restores login.
    await request(server())
      .post(`/api/v1/dashboard/users/${victim.userId}/enable`)
      .set(auth(moderator.token))
      .expect(200);
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'victim@example.com', password: 'password123' })
      .expect(200);
    expect(
      await t.db.collection('dashboardAudit').countDocuments({ action: 'user.unban' } as never),
    ).toBe(1);
  }, 60_000);

  it('refuses self-ban and banning a fellow maintainer', async () => {
    await request(server())
      .post(`/api/v1/dashboard/users/${moderator.userId}/disable`)
      .set(auth(moderator.token))
      .send({})
      .expect(403);

    const peer = await registered('peer@example.com', 'Peer');
    await t.db.collection('dashboardAccounts').insertOne({
      _id: peer.userId,
      role: 'viewer',
      grantedBy: 'test',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);
    await request(server())
      .post(`/api/v1/dashboard/users/${peer.userId}/disable`)
      .set(auth(moderator.token))
      .send({})
      .expect(409);
  });

  it('a viewer (no users.ban) gets 403 on the ban route', async () => {
    const viewer = await registered('viewonly@example.com', 'Vo');
    await t.db.collection('dashboardAccounts').insertOne({
      _id: viewer.userId,
      role: 'viewer',
      grantedBy: 'test',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const target = await registered('target@example.com', 'Tg');
    await request(server())
      .post(`/api/v1/dashboard/users/${target.userId}/disable`)
      .set(auth(viewer.token))
      .send({})
      .expect(403);
  });
});
