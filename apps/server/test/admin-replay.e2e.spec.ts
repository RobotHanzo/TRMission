import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { taiwanBoard } from '@trm/engine';
import type { Board } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { actionToCommand, encodeClient, pickAction } from './helpers';

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

let viewer: { token: string; id: string };
let noPerm: { token: string; id: string };
let board: Board;
let completedGameId: string;
let terminatedGameId: string;

beforeAll(async () => {
  t = await createTestApp();
  board = taiwanBoard();
  viewer = await registered('viewer@example.com', 'Viewer');
  await grantDashboard(viewer.id, 'viewer');
  noPerm = await registered('noperm@example.com', 'NoPerm');

  // A fully COMPLETED game, driven to GAME_OVER through the hub like history-replay.e2e.spec.ts.
  const host = await guest('Host');
  const member = await guest('Member');
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({})
    .expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(member.token)).expect(200);
  for (const u of [host, member]) {
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(u.token))
      .send({ ready: true })
      .expect(200);
  }
  const started = await request(server())
    .post(`/api/v1/rooms/${code}/start`)
    .set(auth(host.token))
    .expect(200);
  completedGameId = started.body.gameId;
  const memberTicket: string = (
    await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(member.token)).expect(200)
  ).body.ticket;

  const hub = t.app.get(GameHub);
  const seqs = new Map<string, number>();
  const nextSeq = (id: string) => {
    const n = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, n);
    return n;
  };
  hub.openConnection('c-host', () => {});
  hub.openConnection('c-member', () => {});
  await hub.receive(
    'c-host',
    encodeClient(nextSeq(host.id), {
      case: 'hello',
      value: { ticket: started.body.ticket, protocolVersion: 1 },
    }),
  );
  await hub.receive(
    'c-member',
    encodeClient(nextSeq(member.id), {
      case: 'hello',
      value: { ticket: memberTicket, protocolVersion: 1 },
    }),
  );

  const match = t.app.get(GameRegistry).get(completedGameId);
  if (!match) throw new Error('match not registered');
  const connOf = new Map([
    [host.id, 'c-host'],
    [member.id, 'c-member'],
  ]);
  let guard = 0;
  while (match.session.phase !== 'GAME_OVER') {
    if (++guard > 50_000) throw new Error('game did not terminate');
    const state = match.session.raw();
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? [host.id, member.id].map(asPlayerId).find((p) => match.session.hasPendingOffer(p))
        : match.session.currentPlayer;
    if (!actor) throw new Error(`no actor in ${state.turn.phase}`);
    await hub.receive(
      connOf.get(actor as string)!,
      encodeClient(nextSeq(actor as string), actionToCommand(pickAction(board, state, actor))),
    );
  }
  await new Promise((r) => setTimeout(r, 50));

  // A TERMINATED game: start, play one action, then force-terminate via the dashboard.
  const admin = await registered('admin@example.com', 'Admin');
  await grantDashboard(admin.id, 'admin');
  const host2 = await guest('Host2');
  const member2 = await guest('Member2');
  const room2 = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host2.token))
    .send({})
    .expect(201);
  const code2: string = room2.body.code;
  await request(server()).post(`/api/v1/rooms/${code2}/join`).set(auth(member2.token)).expect(200);
  for (const u of [host2, member2]) {
    await request(server())
      .post(`/api/v1/rooms/${code2}/ready`)
      .set(auth(u.token))
      .send({ ready: true })
      .expect(200);
  }
  const started2 = await request(server())
    .post(`/api/v1/rooms/${code2}/start`)
    .set(auth(host2.token))
    .expect(200);
  terminatedGameId = started2.body.gameId;
  hub.openConnection('c-host2', () => {});
  await hub.receive(
    'c-host2',
    encodeClient(1, { case: 'hello', value: { ticket: started2.body.ticket, protocolVersion: 1 } }),
  );
  const match2 = t.app.get(GameRegistry).get(terminatedGameId);
  if (!match2) throw new Error('match2 not registered');
  const state2 = match2.session.raw();
  const actor2 =
    state2.turn.phase === 'SETUP_TICKETS' ? asPlayerId(host2.id) : match2.session.currentPlayer;
  await hub.receive(
    'c-host2',
    encodeClient(2, actionToCommand(pickAction(board, state2, actor2 as never))),
  );
  await request(server())
    .post(`/api/v1/dashboard/games/${terminatedGameId}/terminate`)
    .set(auth(admin.token))
    .send({ reason: 'test' })
    .expect(200);
}, 180_000);
afterAll(() => t.close());

describe('POST /dashboard/games/:gameId/replay-ticket', () => {
  it('403s without games.viewReplay', async () => {
    // noPerm holds no dashboardAccounts record at all, so DashboardGuard's nondisclosing
    // posture returns 404 here (not 403) — the same "titled 403s, asserts 404" shape as
    // dashboard-maps.e2e.spec.ts's identical case. games.viewReplay is viewer-tier (the
    // lowest role), so every *actual* dashboard account already holds it — there is no
    // "proven maintainer lacking this permission" case to construct for this route.
    await request(server())
      .post(`/api/v1/dashboard/games/${completedGameId}/replay-ticket`)
      .set(auth(noPerm.token))
      .expect(404);
  });

  it('404s an unknown game', async () => {
    await request(server())
      .post('/api/v1/dashboard/games/nope/replay-ticket')
      .set(auth(viewer.token))
      .expect(404);
  });

  it('mints a ticket for a COMPLETED game (viewer permission is enough)', async () => {
    const res = await request(server())
      .post(`/api/v1/dashboard/games/${completedGameId}/replay-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    expect(typeof res.body.ticket).toBe('string');
  });

  it('mints a ticket for a TERMINATED game', async () => {
    const res = await request(server())
      .post(`/api/v1/dashboard/games/${terminatedGameId}/replay-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    expect(typeof res.body.ticket).toBe('string');
  });
});

async function mintTicket(gameId: string): Promise<string> {
  const res = await request(server())
    .post(`/api/v1/dashboard/games/${gameId}/replay-ticket`)
    .set(auth(viewer.token))
    .expect(200);
  return res.body.ticket;
}

describe('GET /history/:gameId/admin-replay', () => {
  it('404s with no ticket, a garbage ticket, or a ticket scoped to a different game', async () => {
    await request(server()).get(`/api/v1/history/${completedGameId}/admin-replay`).expect(404);
    await request(server())
      .get(`/api/v1/history/${completedGameId}/admin-replay`)
      .query({ ticket: 'garbage' })
      .expect(404);
    const ticketForOther = await mintTicket(terminatedGameId);
    await request(server())
      .get(`/api/v1/history/${completedGameId}/admin-replay`)
      .query({ ticket: ticketForOther })
      .expect(404);
  });

  it('returns the COMPLETED payload: winners + completedAt, no terminatedAt', async () => {
    const ticket = await mintTicket(completedGameId);
    const res = await request(server())
      .get(`/api/v1/history/${completedGameId}/admin-replay`)
      .query({ ticket })
      .expect(200);
    expect(res.body.gameId).toBe(completedGameId);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.actions.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.winners)).toBe(true);
    expect(typeof res.body.completedAt).toBe('string');
    expect(res.body.terminatedAt).toBeUndefined();
    const names = res.body.players.map((p: { displayName?: string }) => p.displayName);
    expect(names).toContain('Host');
  });

  it('returns the TERMINATED payload: terminatedAt/terminatedBy, no winners/completedAt', async () => {
    const ticket = await mintTicket(terminatedGameId);
    const res = await request(server())
      .get(`/api/v1/history/${terminatedGameId}/admin-replay`)
      .query({ ticket })
      .expect(200);
    expect(res.body.gameId).toBe(terminatedGameId);
    expect(res.body.status).toBe('TERMINATED');
    expect(res.body.actions.length).toBe(1);
    expect(res.body.winners).toBeUndefined();
    expect(res.body.completedAt).toBeUndefined();
    expect(typeof res.body.terminatedAt).toBe('string');
    expect(typeof res.body.terminatedBy).toBe('string');
  });
});
