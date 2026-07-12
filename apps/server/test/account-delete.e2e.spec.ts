import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, refreshCookie, FakeAppleTokenRevoker, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
let revoker: FakeAppleTokenRevoker;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  revoker = new FakeAppleTokenRevoker();
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-delete', appleRevoker: revoker });
}, 60_000);
afterAll(() => t.close());

const register = async (email: string, name: string) => {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName: name })
    .expect(201);
  return res;
};

describe('DELETE /auth/me: basic deletion', () => {
  it('deletes a registered account: login, refresh, and /me all die', async () => {
    const reg = await register('gone@example.com', 'Goner');
    const cookie = refreshCookie(reg);
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(204);

    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'gone@example.com', password: 'password123' })
      .expect(401);
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(401); // token cryptographically valid ≤15min, but the user doc is gone
    expect(await t.db.collection('users').countDocuments({ _id: reg.body.user.id as never })).toBe(0);
    expect(await t.db.collection('authSessions').countDocuments({ userId: reg.body.user.id })).toBe(0);
  });

  it('deletes a mobile guest via the body-token transport', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({})
      .expect(201);
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(204);
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(401);
  });
});

describe('DELETE /auth/me: cascade', () => {
  it('leaves LOBBY rooms, pulls history spectatorship, deletes map drafts', async () => {
    const reg = await register('cascade@example.com', 'Cascade');
    const uid = reg.body.user.id as string;
    const now = new Date();
    await t.db.collection('rooms').insertOne({
      _id: 'DELRM1' as never,
      hostId: uid,
      status: 'LOBBY',
      members: [{ userId: uid, displayName: 'Cascade', isGuest: false, seat: 0, ready: false }],
      maxPlayers: 5,
      settings: {},
      createdAt: now,
      updatedAt: now,
    } as never);
    await t.db.collection('matchHistory').insertOne({
      _id: 'delgame1' as never,
      players: [{ userId: 'someone-else', seat: 0 }],
      turnOrder: ['someone-else'],
      seed: 'seed',
      contentHash: 'hash',
      finalScores: { players: [], ranking: [] },
      winners: [],
      spectators: [uid],
      completedAt: now,
    } as never);
    await t.db.collection('customMaps').insertOne({
      _id: 'delmap1' as never,
      ownerId: uid,
      nameZh: '刪',
      nameEn: 'Del',
      revision: 1,
      draft: {},
      createdAt: now,
      updatedAt: now,
    } as never);
    await t.db.collection('userDevices').insertOne({
      _id: 'del-tok-1' as never,
      userId: uid,
      platform: 'android',
      createdAt: now,
      lastSeenAt: now,
    } as never);

    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(204);

    const room = await t.db.collection('rooms').findOne({ _id: 'DELRM1' as never });
    expect(room?.status).toBe('CLOSED'); // sole member left → RoomRepo.leave closes the room
    expect(room?.members).toEqual([]);
    const hist = await t.db.collection('matchHistory').findOne({ _id: 'delgame1' as never });
    expect(hist?.spectators).toEqual([]);
    expect(await t.db.collection('customMaps').countDocuments({ ownerId: uid })).toBe(0);
    expect(await t.db.collection('userDevices').countDocuments({ userId: uid })).toBe(0);
  });

  it('refuses to delete a maintainer with 409 until access is revoked', async () => {
    const reg = await register('maint@example.com', 'Maint');
    await t.db.collection('dashboardAccounts').insertOne({
      _id: reg.body.user.id as never,
      role: 'owner',
      grantedBy: 'system',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(409);
    expect(
      await t.db.collection('users').countDocuments({ _id: reg.body.user.id as never }),
    ).toBe(1);
  });
});

describe('DELETE /auth/me: Apple token revocation', () => {
  it('revokes when the account has an apple identity and a code is supplied', async () => {
    const reg = await register('apple-del@example.com', 'AppleDel');
    await t.db
      .collection('users')
      .updateOne({ _id: reg.body.user.id as never }, { $set: { oauth: { apple: 'sub-1' } } });
    revoker.calls = [];
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ appleAuthorizationCode: 'ac-1' })
      .expect(204);
    expect(revoker.calls).toEqual(['ac-1']);
  });

  it('does not call the revoker without an apple identity', async () => {
    const reg = await register('no-apple@example.com', 'NoApple');
    revoker.calls = [];
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ appleAuthorizationCode: 'ac-2' })
      .expect(204);
    expect(revoker.calls).toEqual([]);
  });

  it('deletion proceeds even when revocation fails', async () => {
    const reg = await register('apple-fail@example.com', 'AppleFail');
    await t.db
      .collection('users')
      .updateOne({ _id: reg.body.user.id as never }, { $set: { oauth: { apple: 'sub-2' } } });
    revoker.result = false;
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ appleAuthorizationCode: 'ac-3' })
      .expect(204);
    revoker.result = true;
    expect(
      await t.db.collection('users').countDocuments({ _id: reg.body.user.id as never }),
    ).toBe(0);
  });
});
