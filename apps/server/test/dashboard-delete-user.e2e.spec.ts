import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// The untyped driver defaults `_id` to ObjectId; these games/rooms/users use string ids.
const rooms = () => t.db.collection<{ _id: string; gameId?: string; status: string }>('rooms');
const games = () => t.db.collection<{ _id: string; status: string }>('games');
const users = () => t.db.collection<{ _id: string }>('users');
const audit = () =>
  t.db.collection<{ action: string; target?: { id: string }; params: Record<string, unknown> }>(
    'dashboardAudit',
  );
const ratings = () => t.db.collection<{ userId: string }>('gameRatings');

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
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

let admin: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  admin = await registered('admin@example.com', 'Admin');
  await grant(admin.userId, 'admin');
}, 60_000);

afterAll(() => t.close());

describe('delete user', () => {
  it('hard-deletes an account: terminates its live game, closes its room, drops owned maps and sessions, keeps match history, audits', async () => {
    const victim = await registered('victim@example.com', 'Vic');

    // An owned custom-map draft (minimal doc — only ownerId matters to deleteByOwner).
    await t.db
      .collection('customMaps')
      .insertOne({ _id: 'cm-victim', ownerId: victim.userId, updatedAt: new Date() } as never);

    // A completed-game archive row referencing the victim — must survive the delete.
    await t.db
      .collection('matchHistory')
      .insertOne({ _id: 'mh-old', gameId: 'g-old', winners: [victim.userId], completedAt: new Date() } as never);

    // A rating the victim submitted — must be dropped on account deletion.
    await ratings().insertOne({
      _id: 'rate-victim' as never,
      userId: victim.userId,
      gameId: 'g-old',
      roomId: 'ABCDE',
      stars: 4,
      createdAt: new Date(),
    } as never);

    // Put the victim in a LIVE game as host (mirrors dashboard-ban.e2e setup).
    const other = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Other' })
      .expect(201);
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(victim.token))
      .send({})
      .expect(201);
    const code = room.body.code as string;
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
    const roomDoc = await rooms().findOne({ _id: code });
    const gameId = roomDoc!.gameId!;
    expect((await games().findOne({ _id: gameId }))?.status).toBe('LIVE');

    // Delete.
    await request(server())
      .delete(`/api/v1/dashboard/users/${victim.userId}`)
      .set(auth(admin.token))
      .send({ reason: 'cleanup' })
      .expect(204);

    // The account is gone.
    expect(await users().findOne({ _id: victim.userId })).toBeNull();
    await request(server())
      .get(`/api/v1/dashboard/users/${victim.userId}`)
      .set(auth(admin.token))
      .expect(404);

    // The live game was terminated and its room closed.
    expect((await games().findOne({ _id: gameId }))?.status).toBe('TERMINATED');
    expect((await rooms().findOne({ _id: code }))?.status).toBe('CLOSED');

    // Owned maps dropped; the archive kept.
    expect(await t.db.collection('customMaps').countDocuments({ ownerId: victim.userId } as never)).toBe(0);
    expect(await t.db.collection('matchHistory').countDocuments({ _id: 'mh-old' } as never)).toBe(1);

    // Ratings dropped too.
    expect(await ratings().countDocuments({ userId: victim.userId } as never)).toBe(0);

    // Audited with counts.
    const entry = await audit().findOne({ action: 'user.delete', 'target.id': victim.userId } as never);
    expect(entry).toBeTruthy();
    expect(entry?.params.gamesTerminated).toBe(1);
    expect(entry?.params.ratingsDeleted).toBe(1);
  }, 60_000);

  it('refuses self-delete (403) and deleting a maintainer (409)', async () => {
    await request(server())
      .delete(`/api/v1/dashboard/users/${admin.userId}`)
      .set(auth(admin.token))
      .send({})
      .expect(403);

    const peer = await registered('peer@example.com', 'Peer');
    await grant(peer.userId, 'viewer');
    await request(server())
      .delete(`/api/v1/dashboard/users/${peer.userId}`)
      .set(auth(admin.token))
      .send({})
      .expect(409);
  });

  it('a moderator (no users.delete) gets 403 on the delete route', async () => {
    const mod = await registered('mod@example.com', 'Mod');
    await grant(mod.userId, 'moderator');
    const target = await registered('target@example.com', 'Tg');
    await request(server())
      .delete(`/api/v1/dashboard/users/${target.userId}`)
      .set(auth(mod.token))
      .send({})
      .expect(403);
  });
});
