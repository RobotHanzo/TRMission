import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { ServerEnvelope } from '@trm/proto';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { encodeClient, decodeServer } from './helpers';

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

describe('force-spectating a LIVE game via the dashboard', () => {
  it('mints a ticket that joins even when the room disables spectating, and serves the roster', async () => {
    const { code, gameId } = await startedRoom({ allowSpectating: false });

    // A normal spectator is blocked by the room setting...
    const blocked = await guest('Blocked');
    await request(server())
      .post(`/api/v1/rooms/${code}/spectate`)
      .set(auth(blocked.token))
      .expect(403);

    // ...but the dashboard-minted ticket bypasses it entirely.
    const mint = await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    const ticket: string = mint.body.ticket;

    // Roster fetch, authorized solely by that same ticket.
    const roster = await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .query({ ticket })
      .expect(200);
    expect(roster.body.players.map((p: { displayName?: string }) => p.displayName)).toContain(
      'Host',
    );

    // The ws-game ticket itself binds a live spectator connection exactly like a real one.
    const hub = t.app.get(GameHub);
    const frames: ServerEnvelope[] = [];
    hub.openConnection('admin-spectate-conn', (bytes) => frames.push(decodeServer(bytes)));
    await hub.receive(
      'admin-spectate-conn',
      encodeClient(1, { case: 'hello', value: { ticket, protocolVersion: 1 } }),
    );
    expect(frames.some((f) => f.event.case === 'welcome')).toBe(true);
    const snap = frames.find((f) => f.event.case === 'snapshot');
    expect(snap).toBeTruthy();
    expect(snap!.event.case === 'snapshot' && snap!.event.value.snapshot?.you).toBeFalsy();
  });

  it('roster fetch 404s with no ticket, a garbage ticket, or a ticket scoped to a different game', async () => {
    const { gameId } = await startedRoom();
    const { gameId: otherGameId } = await startedRoom();
    const mintOther = await request(server())
      .post(`/api/v1/dashboard/games/${otherGameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    await request(server()).get(`/api/v1/history/${gameId}/admin-spectate`).expect(404);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .query({ ticket: 'garbage' })
      .expect(404);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .query({ ticket: mintOther.body.ticket })
      .expect(404);
  });

  it('roster fetch 404s a seated players own (non-spectator) ticket', async () => {
    const { code, gameId, host } = await startedRoom();
    const seatTicket = await request(server())
      .post(`/api/v1/rooms/${code}/ticket`)
      .set(auth(host.token))
      .expect(200);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .query({ ticket: seatTicket.body.ticket })
      .expect(404);
  });
});
