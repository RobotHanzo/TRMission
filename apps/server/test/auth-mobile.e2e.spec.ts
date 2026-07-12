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

describe('mobile version gate', () => {
  it('serves minBuild (default 0) + commitHash', async () => {
    const res = await request(server()).get('/version/mobile').expect(200);
    expect(res.body).toEqual({ minBuild: 0, commitHash: expect.any(String) });
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

describe('mobile OAuth handoff: one-time code round trip', () => {
  let o: TestApp;
  let fake: FakeOauthHttp;
  const oServer = () => o.app.getHttpServer();

  const pickCookie = (res: { headers: Record<string, unknown> }, name: string): string => {
    const sc = res.headers['set-cookie'] as string[] | undefined;
    const c = sc?.find((s) => s.startsWith(`${name}=`));
    return c ? (c.split(';')[0] ?? '') : '';
  };
  const locationOf = (res: { headers: Record<string, unknown> }): string =>
    String(res.headers.location ?? '');

  beforeAll(async () => {
    fake = new FakeOauthHttp();
    o = await createTestApp({
      mongod: sharedMongod,
      dbName: 'trm-test-mobile-oauth',
      authConfig: OAUTH_TEST_CONFIG,
      oauthHttp: fake,
    });
  }, 60_000);
  afterAll(() => o.close());

  it('start(client=mobile) → callback → /m/callback?code → exchange upgrades the carried guest', async () => {
    // Mobile guest signs in and mints a carry code over Bearer.
    const guest = await request(oServer())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({ displayName: 'MobileGuest' })
      .expect(201);
    const carry = await request(oServer())
      .post('/api/v1/auth/mobile/carry')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(201);
    expect(carry.body.code).toBeTruthy();

    // System browser: start → provider → callback.
    fake.profile = {
      sub: 'g-mob-1',
      email: 'mobileguest@example.com',
      emailVerified: true,
      displayName: 'MobileGuest',
      avatarUrl: null,
    };
    fake.fail = false;
    const start = await request(oServer())
      .get('/api/v1/auth/oauth/google/start')
      .query({ client: 'mobile', carry: carry.body.code })
      .expect(302);
    const state = new URL(locationOf(start)).searchParams.get('state');
    const cb = await request(oServer())
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', pickCookie(start, 'trm_oauth'))
      .expect(302);

    // Mobile landing: deep-link URL with a one-time code, and NO refresh cookie.
    const loc = new URL(locationOf(cb));
    expect(loc.pathname).toBe('/m/callback');
    const code = loc.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(refreshCookie(cb)).toBe('');

    // Exchange: tokens in the body, guest upgraded in place (same id).
    const ex = await request(oServer())
      .post('/api/v1/auth/mobile/exchange')
      .send({ code })
      .expect(200);
    expect(ex.body.user.id).toBe(guest.body.user.id);
    expect(ex.body.user.isGuest).toBe(false);
    expect(ex.body.user.email).toBe('mobileguest@example.com');
    expect(ex.body.accessToken).toBeTruthy();
    expect(ex.body.refreshToken).toBeTruthy();

    // The code is single-use.
    await request(oServer()).post('/api/v1/auth/mobile/exchange').send({ code }).expect(401);

    // The returned refresh token works on the body transport.
    await request(oServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: ex.body.refreshToken })
      .expect(200);
  });

  it('mobile error paths land on /m/callback with an error param', async () => {
    fake.profile = {
      sub: 'g-mob-2',
      email: 'unverified-mobile@example.com',
      emailVerified: false,
      displayName: 'Nope',
      avatarUrl: null,
    };
    const start = await request(oServer())
      .get('/api/v1/auth/oauth/google/start')
      .query({ client: 'mobile' })
      .expect(302);
    const state = new URL(locationOf(start)).searchParams.get('state');
    const cb = await request(oServer())
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', pickCookie(start, 'trm_oauth'))
      .expect(302);
    const loc = new URL(locationOf(cb));
    expect(loc.pathname).toBe('/m/callback');
    expect(loc.searchParams.get('error')).toBe('email_unverified');
  });

  it('web flow still sets the cookie and redirects to /login/callback', async () => {
    fake.profile = {
      sub: 'g-web-1',
      email: 'stillweb@example.com',
      emailVerified: true,
      displayName: 'StillWeb',
      avatarUrl: null,
    };
    const start = await request(oServer()).get('/api/v1/auth/oauth/google/start').expect(302);
    const state = new URL(locationOf(start)).searchParams.get('state');
    const cb = await request(oServer())
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', pickCookie(start, 'trm_oauth'))
      .expect(302);
    expect(locationOf(cb)).toContain('/login/callback');
    expect(refreshCookie(cb)).toContain('trm_refresh=');
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
