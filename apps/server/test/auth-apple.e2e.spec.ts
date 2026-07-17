import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  createTestApp,
  refreshCookie,
  FakeAppleIdTokenVerifier,
  FakeAppleRedirectClient,
  OAUTH_TEST_CONFIG,
  type TestApp,
} from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
let verifier: FakeAppleIdTokenVerifier;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  verifier = new FakeAppleIdTokenVerifier();
  t = await createTestApp({
    mongod: sharedMongod,
    dbName: 'trm-test-apple',
    authConfig: { ...OAUTH_TEST_CONFIG, appleClientIds: ['dev.robothanzo.trmission'] },
    appleVerifier: verifier,
  });
}, 60_000);
afterAll(() => t.close());

describe('apple: /auth/config advertises the provider', () => {
  it('reports apple: true (credential) but appleRedirect: false without a Services ID', async () => {
    const res = await request(server()).get('/api/v1/auth/config').expect(200);
    expect(res.body.providers).toEqual({
      google: true,
      discord: true,
      apple: true,
      appleRedirect: false,
    });
  });
});

describe('apple credential sign-in', () => {
  it('creates an account from a verified token (Hide My Email relay) and passes audiences', async () => {
    verifier.profile = {
      sub: 'apple-1',
      email: 'x7q9k2@privaterelay.appleid.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    verifier.fail = false;
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt', fullName: 'Apple Person' })
      .expect(200);
    expect(res.body.user.email).toBe('x7q9k2@privaterelay.appleid.com');
    expect(res.body.user.isGuest).toBe(false);
    expect(res.body.user.displayName).toBe('Apple Person');
    expect(res.body.accessToken).toBeTruthy();
    expect(refreshCookie(res)).toContain('trm_refresh='); // web transport by default
    expect(verifier.lastAudience).toEqual(['dev.robothanzo.trmission']);
  });

  it('falls back to the email local part when Apple provides no name', async () => {
    verifier.profile = {
      sub: 'apple-2',
      email: 'localpart@example.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt' })
      .expect(200);
    expect(res.body.user.displayName).toBe('localpart');
  });

  it('auto-links to an existing account with the same verified email', async () => {
    const reg = await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'applelink@example.com', password: 'password123', displayName: 'Linker' })
      .expect(201);
    verifier.profile = {
      sub: 'apple-3',
      email: 'applelink@example.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt' })
      .expect(200);
    expect(res.body.user.id).toBe(reg.body.user.id);
  });

  it('upgrades a mobile guest in place via the body refresh token', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({ displayName: 'AppleGuest' })
      .expect(201);
    verifier.profile = {
      sub: 'apple-4',
      email: 'appleguest@example.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .set('x-trm-client', 'mobile')
      .send({ identityToken: 'fake-apple-jwt', refreshToken: guest.body.refreshToken })
      .expect(200);
    expect(res.body.user.id).toBe(guest.body.user.id);
    expect(res.body.user.isGuest).toBe(false);
    expect(res.body.refreshToken).toBeTruthy(); // mobile finish: token in body...
    expect(refreshCookie(res)).toBe(''); // ...and no cookie
  });

  it('rejects an unverified email with 401 (no session issued)', async () => {
    verifier.profile = {
      sub: 'apple-5',
      email: 'unverified@example.com',
      emailVerified: false,
      displayName: '',
      avatarUrl: null,
    };
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt' })
      .expect(401);
    expect(refreshCookie(res)).toBe('');
  });

  it('rejects a token the verifier cannot validate with 401', async () => {
    verifier.fail = true;
    await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'garbage' })
      .expect(401);
    verifier.fail = false;
  });

  it('validates the body via the zod pipe', async () => {
    await request(server()).post('/api/v1/auth/oauth/apple/credential').send({}).expect(400);
  });

  it('rejects with 403 when apple is not configured', async () => {
    const d = await createTestApp({
      mongod: sharedMongod,
      dbName: 'trm-test-apple-off',
      appleVerifier: new FakeAppleIdTokenVerifier(),
    });
    await request(d.app.getHttpServer())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt' })
      .expect(403);
    await d.close();
  });
});

describe('apple redirect flow stays off without a Services ID', () => {
  it('start redirects with provider_disabled when unconfigured', async () => {
    const res = await request(server()).get('/api/v1/auth/oauth/apple/start').expect(302);
    expect(String(res.headers.location)).toContain('error=provider_disabled');
  });
});

describe('apple redirect flow (web + android)', () => {
  const SERVICES_ID = 'dev.robothanzo.trmission.web';
  let ra: TestApp;
  let rVerifier: FakeAppleIdTokenVerifier;
  let rClient: FakeAppleRedirectClient;
  const rServer = () => ra.app.getHttpServer();

  const appleNonceCookie = (res: { headers: Record<string, unknown> }): string => {
    const setCookie = res.headers['set-cookie'] as string[] | undefined;
    const c = setCookie?.find((s) => s.startsWith('trm_oauth_apple='));
    return c ? (c.split(';')[0] ?? '') : '';
  };
  const startFlow = async (query = '') => {
    const res = await request(rServer())
      .get(`/api/v1/auth/oauth/apple/start${query}`)
      .expect(302);
    const url = new URL(String(res.headers.location));
    return { url, state: url.searchParams.get('state') ?? '', cookie: appleNonceCookie(res) };
  };

  beforeAll(async () => {
    rVerifier = new FakeAppleIdTokenVerifier();
    rClient = new FakeAppleRedirectClient();
    ra = await createTestApp({
      mongod: sharedMongod,
      dbName: 'trm-test-apple-redirect',
      authConfig: {
        ...OAUTH_TEST_CONFIG,
        appleClientIds: ['dev.robothanzo.trmission'],
        appleServicesId: SERVICES_ID,
      },
      appleVerifier: rVerifier,
      appleRedirectClient: rClient,
    });
  }, 60_000);
  afterAll(() => ra.close());

  it('advertises appleRedirect: true when the Services ID is configured', async () => {
    const res = await request(rServer()).get('/api/v1/auth/config').expect(200);
    expect(res.body.providers.appleRedirect).toBe(true);
  });

  it('start builds the Apple authorize URL (form_post, Services ID) + nonce cookie', async () => {
    const { url, state, cookie } = await startFlow('?redirect=%2Froom%2FABCDE');
    expect(url.origin + url.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(url.searchParams.get('client_id')).toBe(SERVICES_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('scope')).toBe('name email');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/api/v1/auth/oauth/apple/callback',
    );
    expect(state).toBeTruthy();
    expect(cookie).toContain('trm_oauth_apple=');
  });

  it('web round trip: form_post callback signs in, sets the refresh cookie, honors the name', async () => {
    rClient.idToken = 'fake-redirect-id-token';
    rClient.fail = false;
    rVerifier.profile = {
      sub: 'apple-web-1',
      email: 'appleweb@example.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    rVerifier.fail = false;
    const { state, cookie } = await startFlow('?redirect=%2Froom%2FABCDE');
    const res = await request(rServer())
      .post('/api/v1/auth/oauth/apple/callback')
      .set('Cookie', cookie)
      .type('form')
      .send({
        code: 'web-code-1',
        state,
        user: JSON.stringify({ name: { firstName: '蘋', lastName: '果' } }),
      })
      .expect(302);
    expect(String(res.headers.location)).toContain('/login/callback');
    expect(String(res.headers.location)).not.toContain('error=');
    expect(refreshCookie(res)).toContain('trm_refresh=');
    expect(rClient.calls).toContain('web-code-1');
    // Both the native bundle id and the web Services ID are accepted audiences.
    expect(rVerifier.lastAudience).toEqual(['dev.robothanzo.trmission', SERVICES_ID]);
  });

  it('mobile round trip: callback hands off a single-use exchange code', async () => {
    rClient.idToken = 'fake-redirect-id-token';
    rVerifier.profile = {
      sub: 'apple-android-1',
      email: 'appleandroid@example.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    const { state, cookie } = await startFlow('?client=mobile');
    const cb = await request(rServer())
      .post('/api/v1/auth/oauth/apple/callback')
      .set('Cookie', cookie)
      .type('form')
      .send({ code: 'android-code-1', state })
      .expect(302);
    const loc = new URL(String(cb.headers.location));
    expect(loc.pathname).toBe('/m/callback');
    const exchangeCode = loc.searchParams.get('code');
    expect(exchangeCode).toBeTruthy();

    const exchanged = await request(rServer())
      .post('/api/v1/auth/mobile/exchange')
      .set('x-trm-client', 'mobile')
      .send({ code: exchangeCode })
      .expect(200);
    expect(exchanged.body.user.email).toBe('appleandroid@example.com');
    expect(exchanged.body.refreshToken).toBeTruthy();
  });

  it('rejects a tampered state', async () => {
    const res = await request(rServer())
      .post('/api/v1/auth/oauth/apple/callback')
      .type('form')
      .send({ code: 'c', state: 'garbage' })
      .expect(302);
    expect(String(res.headers.location)).toContain('error=invalid_state');
  });

  it('rejects a mismatched nonce cookie', async () => {
    const { state } = await startFlow();
    const res = await request(rServer())
      .post('/api/v1/auth/oauth/apple/callback')
      .set('Cookie', 'trm_oauth_apple=wrong-nonce')
      .type('form')
      .send({ code: 'c', state })
      .expect(302);
    expect(String(res.headers.location)).toContain('error=invalid_state');
  });

  it('redirects with exchange_failed when Apple rejects the code', async () => {
    rClient.fail = true;
    const { state, cookie } = await startFlow();
    const res = await request(rServer())
      .post('/api/v1/auth/oauth/apple/callback')
      .set('Cookie', cookie)
      .type('form')
      .send({ code: 'bad', state })
      .expect(302);
    expect(String(res.headers.location)).toContain('error=exchange_failed');
    rClient.fail = false;
  });
});
