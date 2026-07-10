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
  return { token: res.body.accessToken, id: res.body.user.id as string };
}
async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id as string };
}
async function grantDashboard(userId: string, role: 'viewer' | 'moderator' | 'admin') {
  await t.db.collection('dashboardAccounts').insertOne({
    _id: userId,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

async function startedRoom(
  patch?: object,
): Promise<{ code: string; gameId: string; host: { token: string; id: string } }> {
  const a = await guest('Host');
  const b = await guest('Player');
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(a.token))
    .send({})
    .expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
  if (patch) {
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send(patch)
      .expect(200);
  }
  await request(server())
    .post(`/api/v1/rooms/${code}/ready`)
    .set(auth(a.token))
    .send({ ready: true })
    .expect(200);
  await request(server())
    .post(`/api/v1/rooms/${code}/ready`)
    .set(auth(b.token))
    .send({ ready: true })
    .expect(200);
  const started = await request(server())
    .post(`/api/v1/rooms/${code}/start`)
    .set(auth(a.token))
    .expect(200);
  return { code, gameId: started.body.gameId, host: a };
}

let viewer: { token: string; id: string };
let noPerm: { token: string; id: string };

beforeAll(async () => {
  t = await createTestApp();
  viewer = await registered('spectate-viewer@example.com', 'Viewer');
  await grantDashboard(viewer.id, 'viewer');
  noPerm = await registered('spectate-noperm@example.com', 'NoPerm');
}, 60_000);
afterAll(() => t.close());

describe('POST /dashboard/games/:gameId/spectate-ticket', () => {
  it('404s (nondisclosing) without games.spectateLive', async () => {
    const { gameId } = await startedRoom();
    await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(noPerm.token))
      .expect(404);
  });

  it('404s an unknown game', async () => {
    await request(server())
      .post('/api/v1/dashboard/games/nope/spectate-ticket')
      .set(auth(viewer.token))
      .expect(404);
  });

  it('409s a game that is not LIVE', async () => {
    const { gameId } = await startedRoom();
    const admin = await registered('spectate-admin@example.com', 'Admin');
    await grantDashboard(admin.id, 'admin');
    await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/terminate`)
      .set(auth(admin.token))
      .send({ reason: 'test' })
      .expect(200);
    await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(409);
  });

  it('mints a ticket for a LIVE game', async () => {
    const { gameId } = await startedRoom();
    const res = await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    expect(typeof res.body.ticket).toBe('string');
    expect(typeof res.body.expiresIn).toBe('string');
  });
});
