import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { OFFICIAL_MAPS } from '@trm/map-data';
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

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

async function grant(userId: string, role: string) {
  await t.db.collection('dashboardAccounts').insertOne({
    _id: userId,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

let admin: { userId: string; token: string };
let viewer: { userId: string; token: string };
let host: { userId: string; token: string };
let liveGameId: string;
let roomCode: string;
const doneGameId = 'game-completed-fixture';

beforeAll(async () => {
  t = await createTestApp();
  admin = await registered('admin@example.com', 'Admin');
  viewer = await registered('viewer@example.com', 'Viewer');
  await grant(admin.userId, 'admin');
  await grant(viewer.userId, 'viewer');

  // A real LIVE game through the lobby (host + member, both ready, start).
  host = await guest('Host');
  const member = await guest('Member');
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({})
    .expect(201);
  roomCode = room.body.code;
  await request(server())
    .post(`/api/v1/rooms/${roomCode}/join`)
    .set(auth(member.token))
    .expect(200);
  for (const u of [host, member]) {
    await request(server())
      .post(`/api/v1/rooms/${roomCode}/ready`)
      .set(auth(u.token))
      .send({ ready: true })
      .expect(200);
  }
  const started = await request(server())
    .post(`/api/v1/rooms/${roomCode}/start`)
    .set(auth(host.token))
    .expect(200);
  liveGameId = started.body.gameId;

  // A fabricated COMPLETED game: the read endpoints only touch Mongo, so a synthetic
  // doc set exercises them without driving a full game through the engine.
  const contentHash = OFFICIAL_MAPS[0]!.hash;
  const now = new Date();
  await t.db.collection('games').insertOne({
    _id: doneGameId,
    seed: 'seed-fixture',
    config: {
      seed: 'seed-fixture',
      players: [
        { id: 'p-one', seat: 0 },
        { id: 'p-two', seat: 1 },
      ],
      contentHash,
    },
    engineVersion: 1,
    contentHash,
    schemaVersion: 1,
    status: 'COMPLETED',
    currentSeq: 2,
    createdAt: now,
    updatedAt: now,
  } as never);
  await t.db.collection('gameEvents').insertMany([
    { gameId: doneGameId, seq: 1, action: { type: 'X' }, stateDigest: 'd1', ts: now },
    { gameId: doneGameId, seq: 2, action: { type: 'Y' }, stateDigest: 'd2', ts: now },
  ] as never[]);
  await t.db.collection('gameChats').insertMany([
    {
      gameId: doneGameId,
      seq: 0,
      playerId: 'p-one',
      content: { case: 'text', value: 'gg' },
      ts: now,
    },
    {
      gameId: doneGameId,
      seq: 1,
      playerId: 'p-two',
      content: { case: 'presetId', value: 'GOOD_GAME' },
      ts: now,
    },
  ] as never[]);
  await t.db.collection('matchHistory').insertOne({
    _id: doneGameId,
    players: [
      { userId: 'p-one', seat: 0 },
      { userId: 'p-two', seat: 1 },
    ],
    turnOrder: ['p-one', 'p-two'],
    seed: 'seed-fixture',
    contentHash,
    finalScores: { totals: {} },
    winners: ['p-one'],
    completedAt: now,
  } as never);
}, 120_000);

afterAll(() => t.close());

describe('overview', () => {
  it('reports counts, metric snapshot, and versions', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/overview')
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.liveGames.db).toBeGreaterThanOrEqual(1);
    expect(res.body.liveGames.inMemory).toBeGreaterThanOrEqual(1);
    expect(res.body.rooms.started).toBeGreaterThanOrEqual(1);
    expect(res.body.users.total).toBeGreaterThanOrEqual(4);
    expect(res.body.users.guests).toBeGreaterThanOrEqual(2);
    expect(res.body.sessions.active).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.metrics.activeConnections).toBe('number');
    expect(typeof res.body.metrics.leaksBlocked).toBe('number');
    expect(typeof res.body.metrics.residentMemoryBytes).toBe('number');
    expect(typeof res.body.versions.engineVersion).toBe('number');
    expect(typeof res.body.versions.uptimeSeconds).toBe('number');
    expect(res.body.versions.commitHash).toBe('dev'); // no GIT_COMMIT set in tests
  });

  it('403s a viewer on a permission they lack (audit.read) but not on overview', async () => {
    await request(server()).get('/api/v1/dashboard/overview').set(auth(viewer.token)).expect(200);
    await request(server()).get('/api/v1/dashboard/audit').set(auth(viewer.token)).expect(403);
    await request(server()).get('/api/v1/dashboard/audit').set(auth(admin.token)).expect(200);
  });
});

describe('users', () => {
  it('lists users newest-first and filters guests', async () => {
    const all = await request(server())
      .get('/api/v1/dashboard/users')
      .set(auth(admin.token))
      .expect(200);
    expect(all.body.users.length).toBeGreaterThanOrEqual(4);
    const guests = await request(server())
      .get('/api/v1/dashboard/users?filter=guests')
      .set(auth(admin.token))
      .expect(200);
    expect(guests.body.users.every((u: { isGuest: boolean }) => u.isGuest)).toBe(true);
    // No secret fields in any row.
    const flat = JSON.stringify(all.body);
    expect(flat).not.toContain('passwordHash');
    expect(flat).not.toContain('tokenVersion');
  });

  it('search escapes regex metacharacters instead of erroring or matching all', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/users?q=' + encodeURIComponent('a+b('))
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.users).toEqual([]);
  });

  it('search finds by displayName prefix, case-insensitively', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/users?q=adm')
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.users.some((u: { id: string }) => u.id === admin.userId)).toBe(true);
  });

  it('registered accounts report hasPassword; guest accounts report a pending guestExpiresAt', async () => {
    const all = await request(server())
      .get('/api/v1/dashboard/users')
      .set(auth(admin.token))
      .expect(200);
    const adminRow = all.body.users.find((u: { id: string }) => u.id === admin.userId);
    expect(adminRow.hasPassword).toBe(true);
    expect(adminRow.guestExpiresAt).toBeUndefined();

    const guests = await request(server())
      .get('/api/v1/dashboard/users?filter=guests')
      .set(auth(admin.token))
      .expect(200);
    const hostRow = guests.body.users.find((u: { id: string }) => u.id === host.userId);
    expect(hostRow.hasPassword).toBe(false);
    expect(typeof hostRow.guestExpiresAt).toBe('string');
  });

  it('user detail includes sessions, active rooms, and maintainer flag', async () => {
    const res = await request(server())
      .get(`/api/v1/dashboard/users/${host.userId}`)
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.activeSessions).toBeGreaterThanOrEqual(1);
    expect(res.body.activeRooms.map((r: { code: string }) => r.code)).toContain(roomCode);
    expect(res.body.isMaintainer).toBe(false);
    expect(Array.isArray(res.body.history)).toBe(true);

    const me = await request(server())
      .get(`/api/v1/dashboard/users/${admin.userId}`)
      .set(auth(admin.token))
      .expect(200);
    expect(me.body.isMaintainer).toBe(true);
  });
});

describe('games', () => {
  it('lists LIVE games with the inMemory flag', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/games?status=LIVE')
      .set(auth(admin.token))
      .expect(200);
    const row = res.body.games.find((g: { gameId: string }) => g.gameId === liveGameId);
    expect(row).toBeTruthy();
    expect(row.inMemory).toBe(true);
    expect(row.playerCount).toBe(2);
  });

  it('LIVE game detail leaks no seed anywhere in the payload', async () => {
    const res = await request(server())
      .get(`/api/v1/dashboard/games/${liveGameId}`)
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.status).toBe('LIVE');
    expect(res.body.roomCode).toBe(roomCode);
    expect(res.body.players).toHaveLength(2);
    // The mini leak test: no `seed` key may appear anywhere in the JSON.
    expect(JSON.stringify(res.body)).not.toContain('"seed"');
  });

  it('COMPLETED game detail includes the seed', async () => {
    const res = await request(server())
      .get(`/api/v1/dashboard/games/${doneGameId}`)
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.seed).toBe('seed-fixture');
  });

  it('COMPLETED game detail exposes chat with a text/preset discriminator', async () => {
    const res = await request(server())
      .get(`/api/v1/dashboard/games/${doneGameId}`)
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.chat).toEqual([
      { playerId: 'p-one', ts: expect.any(String), kind: 'text', value: 'gg' },
      { playerId: 'p-two', ts: expect.any(String), kind: 'preset', value: 'GOOD_GAME' },
    ]);
  });

  it('action log: 409 for LIVE, full entries for COMPLETED (moderator permission)', async () => {
    await request(server())
      .get(`/api/v1/dashboard/games/${liveGameId}/log`)
      .set(auth(admin.token))
      .expect(409);
    const res = await request(server())
      .get(`/api/v1/dashboard/games/${doneGameId}/log`)
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries[0].stateDigest).toBe('d1');
    // A viewer lacks games.readLog:
    await request(server())
      .get(`/api/v1/dashboard/games/${doneGameId}/log`)
      .set(auth(viewer.token))
      .expect(403);
  });

  it('replay: served to a non-member maintainer, while /history stays membership-gated', async () => {
    const res = await request(server())
      .get(`/api/v1/dashboard/games/${doneGameId}/replay`)
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.actions).toHaveLength(2);
    expect(res.body.winners).toEqual(['p-one']);
    // The public history route still 404s the same non-member for the same game.
    await request(server())
      .get(`/api/v1/history/${doneGameId}/replay`)
      .set(auth(admin.token))
      .expect(404);
  });
});

describe('rooms', () => {
  it('lists rooms with status and members', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/rooms?status=STARTED')
      .set(auth(admin.token))
      .expect(200);
    const row = res.body.rooms.find((r: { code: string }) => r.code === roomCode);
    expect(row).toBeTruthy();
    expect(row.memberCount).toBe(2);
    expect(row.gameId).toBe(liveGameId);
  });
});
