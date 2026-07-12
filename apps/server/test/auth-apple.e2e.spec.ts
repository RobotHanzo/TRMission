import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  createTestApp,
  refreshCookie,
  FakeAppleIdTokenVerifier,
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
    authConfig: { ...OAUTH_TEST_CONFIG, appleClientIds: ['tw.trmission.app'] },
    appleVerifier: verifier,
  });
}, 60_000);
afterAll(() => t.close());

describe('apple: /auth/config advertises the provider', () => {
  it('reports apple: true when audiences are configured', async () => {
    const res = await request(server()).get('/api/v1/auth/config').expect(200);
    expect(res.body.providers).toEqual({ google: true, discord: true, apple: true });
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
    expect(verifier.lastAudience).toEqual(['tw.trmission.app']);
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

describe('apple stays credential-only', () => {
  it('the redirect flow rejects apple as a provider', async () => {
    const res = await request(server()).get('/api/v1/auth/oauth/apple/start').expect(302);
    expect(String(res.headers.location)).toContain('error=provider_disabled');
  });
});
