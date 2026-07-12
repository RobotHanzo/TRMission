import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-moderation' });
}, 60_000);
afterAll(() => t.close());

describe('blocks: the client-side mute list', () => {
  it('starts empty, adds idempotently, lists, and removes', async () => {
    const a = await guest('Blocker');
    const b = await guest('Loudmouth');

    const empty = await request(server()).get('/api/v1/me/blocks').set(auth(a.token)).expect(200);
    expect(empty.body).toEqual({ blockedUserIds: [] });

    await request(server()).put(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(204);
    // Idempotent: re-blocking is a no-op success, not an error.
    await request(server()).put(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(204);

    const one = await request(server()).get('/api/v1/me/blocks').set(auth(a.token)).expect(200);
    expect(one.body.blockedUserIds).toEqual([b.userId]);

    await request(server()).delete(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(204);
    const gone = await request(server()).get('/api/v1/me/blocks').set(auth(a.token)).expect(200);
    expect(gone.body.blockedUserIds).toEqual([]);
  });

  it('rejects blocking yourself (400) and unknown users (404); requires auth (401)', async () => {
    const a = await guest('Selfish');
    await request(server()).put(`/api/v1/me/blocks/${a.userId}`).set(auth(a.token)).expect(400);
    await request(server()).put('/api/v1/me/blocks/no-such-user').set(auth(a.token)).expect(404);
    await request(server()).get('/api/v1/me/blocks').expect(401);
  });

  it('409s when the list is full (cap 500)', async () => {
    const a = await guest('Collector');
    const b = await guest('OneMore');
    await t.db
      .collection('users')
      .updateOne(
        { _id: a.userId as never },
        { $set: { blockedUserIds: Array.from({ length: 500 }, (_, i) => `padding-${i}`) } },
      );
    await request(server()).put(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(409);
  });
});

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

describe('reports: player', () => {
  it('files a report with context and returns its id', async () => {
    const reporter = await guest('Reporter');
    const target = await guest('Menace');
    const res = await request(server())
      .post('/api/v1/reports/player')
      .set(auth(reporter.token))
      .send({
        userId: target.userId,
        category: 'HARASSMENT',
        message: 'said awful things in chat',
        roomCode: 'ABCD',
      })
      .expect(201);
    expect(res.body.id).toBeTruthy();

    const doc = await t.db.collection('reports').findOne({ reportedUserId: target.userId });
    expect(doc).toMatchObject({
      kind: 'player',
      status: 'open',
      category: 'HARASSMENT',
      reporterId: reporter.userId,
      reporterName: 'Reporter',
      reportedName: 'Menace',
      roomCode: 'ABCD',
    });
  });

  it('rejects self-reports (400), unknown targets (404), bad categories (400), anon (401)', async () => {
    const a = await guest('SoloReporter');
    await request(server())
      .post('/api/v1/reports/player')
      .set(auth(a.token))
      .send({ userId: a.userId, category: 'SPAM' })
      .expect(400);
    await request(server())
      .post('/api/v1/reports/player')
      .set(auth(a.token))
      .send({ userId: 'no-such-user', category: 'SPAM' })
      .expect(404);
    await request(server())
      .post('/api/v1/reports/player')
      .set(auth(a.token))
      .send({ userId: a.userId, category: 'NOT_A_CATEGORY' })
      .expect(400);
    await request(server())
      .post('/api/v1/reports/player')
      .send({ userId: 'x', category: 'SPAM' })
      .expect(401);
  });
});

describe('reports: custom map by share code', () => {
  it('resolves the code and snapshots the map identity onto the report', async () => {
    // A registered builder shares a map (mapBuilder feature granted straight in the DB —
    // the dashboard grant flow is already covered by its own suite).
    const owner = await registered('builder@example.com', 'Builder');
    await t.db
      .collection('users')
      .updateOne({ _id: owner.userId as never }, { $set: { features: ['mapBuilder'] } });
    const map = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: '測試地圖', nameEn: 'Test Map' })
      .expect(201);
    // mint-or-refetch is idempotent → the maps API answers 200, not 201
    const share = await request(server())
      .post(`/api/v1/maps/${map.body.id}/share`)
      .set(auth(owner.token))
      .expect(200);
    const code = share.body.shareCode as string;

    const reporter = await guest('MapWatcher');
    const res = await request(server())
      .post('/api/v1/reports/map')
      .set(auth(reporter.token))
      .send({ shareCode: code, category: 'INAPPROPRIATE_CONTENT' })
      .expect(201);
    expect(res.body.id).toBeTruthy();

    const doc = await t.db.collection('reports').findOne({ shareCode: code });
    expect(doc).toMatchObject({
      kind: 'map',
      status: 'open',
      mapId: map.body.id,
      mapOwnerId: owner.userId,
      mapNameZh: '測試地圖',
      mapNameEn: 'Test Map',
    });
  });

  it('404s an unknown share code', async () => {
    const reporter = await guest('LostCode');
    await request(server())
      .post('/api/v1/reports/map')
      .set(auth(reporter.token))
      .send({ shareCode: 'ZZZZZZZZ', category: 'SPAM' })
      .expect(404);
  });
});
