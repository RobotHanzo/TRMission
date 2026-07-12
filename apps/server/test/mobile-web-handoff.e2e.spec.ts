import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, refreshCookie, OAUTH_TEST_CONFIG, type TestApp } from './app';

let mongod: MongoMemoryServer;
let t: TestApp;
const server = () => t.app.getHttpServer();
const locationOf = (res: { headers: Record<string, unknown> }): string =>
  String(res.headers.location ?? '');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  // OAUTH_TEST_CONFIG pins redirectBase to http://localhost:5173 so Location asserts are exact.
  t = await createTestApp({
    mongod,
    dbName: 'trm-test-web-handoff',
    authConfig: OAUTH_TEST_CONFIG,
  });
}, 60_000);
afterAll(async () => {
  await t.close();
  await mongod.stop();
});

describe('GET /api/v1/auth/mobile-web-handoff (builder WebView session handoff)', () => {
  it('redeems a carry code into the Strict refresh cookie and lands on /maps', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({ displayName: 'Builder' })
      .expect(201);

    const carry = await request(server())
      .post('/api/v1/auth/mobile/carry')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(201);

    const res = await request(server())
      .get('/api/v1/auth/mobile-web-handoff')
      .query({ code: carry.body.code })
      .expect(302);
    expect(locationOf(res)).toBe('http://localhost:5173/maps');
    const cookie = refreshCookie(res);
    expect(cookie).toContain('trm_refresh=');

    // The cookie is a real web session: the cookie-transport refresh path accepts it.
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);

    // The app's own body-token family is untouched (the handoff mints a NEW family).
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(200);
  });

  it('codes are single-use: a replay gets an error redirect and no cookie', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({})
      .expect(201);
    const carry = await request(server())
      .post('/api/v1/auth/mobile/carry')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(201);

    await request(server())
      .get('/api/v1/auth/mobile-web-handoff')
      .query({ code: carry.body.code })
      .expect(302);
    const replay = await request(server())
      .get('/api/v1/auth/mobile-web-handoff')
      .query({ code: carry.body.code })
      .expect(302);
    expect(locationOf(replay)).toBe('http://localhost:5173/login/callback?error=invalid_code');
    expect(refreshCookie(replay)).toBe('');
  });

  it('missing or garbage codes get the error redirect, never a 500 or a cookie', async () => {
    const missing = await request(server()).get('/api/v1/auth/mobile-web-handoff').expect(302);
    expect(locationOf(missing)).toBe('http://localhost:5173/login/callback?error=invalid_code');
    expect(refreshCookie(missing)).toBe('');

    const garbage = await request(server())
      .get('/api/v1/auth/mobile-web-handoff')
      .query({ code: 'not-a-real-code' })
      .expect(302);
    expect(locationOf(garbage)).toBe('http://localhost:5173/login/callback?error=invalid_code');
    expect(refreshCookie(garbage)).toBe('');
  });
});
