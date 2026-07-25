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
async function grantDashboard(userId: string, role: 'viewer' | 'moderator' | 'admin' | 'owner') {
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
let owner: { token: string; id: string };

beforeAll(async () => {
  t = await createTestApp();
  viewer = await registered('spectate-viewer@example.com', 'Viewer');
  await grantDashboard(viewer.id, 'viewer');
  noPerm = await registered('spectate-noperm@example.com', 'NoPerm');
  // owner: needed to revoke another maintainer's dashboardAccounts record for the
  // instant-revocation admin-spectate test below (maintainers.write is owner-only).
  owner = await registered('spectate-owner@example.com', 'Owner');
  await grantDashboard(owner.id, 'owner');
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

// The ticket rides in a header, not `?ticket=` — see admin-spectate.guard.ts.
const withTicket = (ticket: string) => ({ 'x-trm-admin-ticket': ticket });

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

    // Roster fetch: header-carried ticket, presented by the maintainer session it was minted
    // for, whose games.spectateLive access is re-checked per request.
    const roster = await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .set(auth(viewer.token))
      .set(withTicket(ticket))
      .expect(200);
    expect(roster.body.players.map((p: { displayName?: string }) => p.displayName)).toContain(
      'Host',
    );

    // The ws-game ticket itself binds a live spectator connection exactly like a real one — the
    // first-frame ClientHello handoff is a different, session-less-by-design mechanism shared
    // by every player/spectator and is untouched by this guard's header/session tightening.
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

  it('roster fetch 401s with no bearer session at all, even carrying a valid ticket', async () => {
    const { gameId } = await startedRoom();
    const mint = await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .set(withTicket(mint.body.ticket))
      .expect(401);
  });

  it('roster fetch 404s with no ticket header, a garbage ticket, or a ticket scoped to a different game', async () => {
    const { gameId } = await startedRoom();
    const { gameId: otherGameId } = await startedRoom();
    const mintOther = await request(server())
      .post(`/api/v1/dashboard/games/${otherGameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .set(auth(viewer.token))
      .expect(404);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .set(auth(viewer.token))
      .set(withTicket('garbage'))
      .expect(404);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .set(auth(viewer.token))
      .set(withTicket(mintOther.body.ticket))
      .expect(404);
  });

  it('roster fetch 404s the old `?ticket=` query-string form — the header is now the only accepted transport', async () => {
    const { gameId } = await startedRoom();
    const mint = await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .set(auth(viewer.token))
      .query({ ticket: mint.body.ticket })
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
      .set(auth(host.token))
      .set(withTicket(seatTicket.body.ticket))
      .expect(404);
  });

  it('roster fetch 404s when a DIFFERENT maintainer presents a ticket minted for someone else, even holding games.spectateLive themselves', async () => {
    const { gameId } = await startedRoom();
    const mint = await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    const otherViewer = await registered('spectate-other-viewer@example.com', 'OtherViewer');
    await grantDashboard(otherViewer.id, 'viewer');
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .set(auth(otherViewer.token))
      .set(withTicket(mint.body.ticket))
      .expect(404);
  });

  it('roster fetch 404s once the minting maintainer’s dashboard access is revoked mid-window (instant revocation)', async () => {
    const { gameId } = await startedRoom();
    const revocable = await registered('revocable-spectate@example.com', 'Revocable');
    await grantDashboard(revocable.id, 'viewer');
    const mint = await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(revocable.token))
      .expect(200);

    // Access revoked AFTER minting, while the (45-second) ticket is still unexpired.
    await request(server())
      .delete(`/api/v1/dashboard/maintainers/${revocable.id}`)
      .set(auth(owner.token))
      .expect(204);

    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .set(auth(revocable.token)) // the access token itself is still valid — only dashboard access was revoked
      .set(withTicket(mint.body.ticket))
      .expect(404);
  });
});
