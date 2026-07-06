import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  createTestApp,
  refreshCookie,
  FakeGoogleIdTokenVerifier,
  FakeOauthHttp,
  OAUTH_TEST_CONFIG,
  type TestApp,
} from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-mobile' });
}, 60_000);
afterAll(() => t.close());

describe('mobile issuance: x-trm-client header returns the refresh token in the body', () => {
  it('guest with the mobile header gets refreshToken and NO cookie', async () => {
    const res = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({ displayName: 'Pocket' })
      .expect(201);
    expect(res.body.refreshToken).toBeTruthy();
    expect(refreshCookie(res)).toBe('');
  });

  it("web guest (no header) keeps today's behavior: cookie set, no body token", async () => {
    const res = await request(server()).post('/api/v1/auth/guest').send({}).expect(201);
    expect(res.body.refreshToken).toBeUndefined();
    expect(refreshCookie(res)).toContain('trm_refresh=');
  });
});

describe('mobile refresh/logout: token in the body', () => {
  it('rotates via body token and burns the family on reuse', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({})
      .expect(201);
    const t1 = guest.body.refreshToken as string;

    const r1 = await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: t1 })
      .expect(200);
    expect(r1.body.accessToken).toBeTruthy();
    expect(r1.body.refreshToken).toBeTruthy();
    expect(r1.body.refreshToken).not.toBe(t1);
    expect(refreshCookie(r1)).toBe(''); // body transport never sets the cookie

    // Reusing the rotated-away token = theft → family burned, latest token dies too.
    await request(server()).post('/api/v1/auth/refresh').send({ refreshToken: t1 }).expect(401);
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('logout accepts the body token', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({})
      .expect(201);
    await request(server())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(204);
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(401);
  });
});

describe('google credential: mobile audiences', () => {
  let o: TestApp;
  let verifier: FakeGoogleIdTokenVerifier;
  const oServer = () => o.app.getHttpServer();

  beforeAll(async () => {
    verifier = new FakeGoogleIdTokenVerifier();
    o = await createTestApp({
      mongod: sharedMongod,
      dbName: 'trm-test-mobile-aud',
      authConfig: { ...OAUTH_TEST_CONFIG, googleMobileClientIds: ['ios-id', 'android-id'] },
      googleVerifier: verifier,
    });
  }, 60_000);
  afterAll(() => o.close());

  it('passes web + mobile client ids to the verifier', async () => {
    verifier.profile = {
      sub: 'g-m-1',
      email: 'mobileaud@example.com',
      emailVerified: true,
      displayName: 'MobileAud',
      avatarUrl: null,
    };
    verifier.fail = false;
    await request(oServer())
      .post('/api/v1/auth/oauth/google/credential')
      .set('x-trm-client', 'mobile')
      .send({ credential: 'fake-jwt' })
      .expect(200);
    expect(verifier.lastAudience).toEqual(['gid', 'ios-id', 'android-id']);
  });
});

describe('guest TTL: refresh slides guestExpiresAt forward', () => {
  it('extends an almost-expired guest on refresh', async () => {
    const guest = await request(server()).post('/api/v1/auth/guest').send({}).expect(201);
    const id = guest.body.user.id as string;

    // Backdate the TTL anchor to nearly-now, as if the guest were 30 days old.
    await t.db
      .collection('users')
      .updateOne({ _id: id as never }, { $set: { guestExpiresAt: new Date(Date.now() + 1000) } });

    await request(server())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(guest))
      .expect(200);

    const doc = await t.db.collection('users').findOne({ _id: id as never });
    const twentyDays = 20 * 24 * 60 * 60 * 1000;
    expect((doc?.guestExpiresAt as Date).getTime()).toBeGreaterThan(Date.now() + twentyDays);
  });
});
