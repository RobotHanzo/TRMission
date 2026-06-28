import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  refreshCookie,
  FakeOauthHttp,
  OAUTH_TEST_CONFIG,
  type TestApp,
} from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();

const pickCookie = (res: { headers: Record<string, unknown> }, name: string): string => {
  const sc = res.headers['set-cookie'] as string[] | undefined;
  const c = sc?.find((s) => s.startsWith(`${name}=`));
  return c ? (c.split(';')[0] ?? '') : '';
};
const locationOf = (res: { headers: Record<string, unknown> }): string =>
  String(res.headers.location ?? '');

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(() => t.close());

describe('auth: /config endpoint', () => {
  it('reports the default method set (password + guest on, no providers)', async () => {
    const res = await request(server()).get('/api/v1/auth/config').expect(200);
    expect(res.body).toEqual({
      passwordLogin: true,
      guest: true,
      providers: { google: false, discord: false },
    });
  });
});

describe('auth: guest + access token', () => {
  it('issues a guest session and authenticates /me', async () => {
    const res = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Tester' })
      .expect(201);
    expect(res.body.user.isGuest).toBe(true);
    expect(res.body.accessToken).toBeTruthy();

    const me = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(res.body.user.id);
    expect(me.body.displayName).toBe('Tester');
  });

  it('rejects /me without (or with a bad) token', async () => {
    await request(server()).get('/api/v1/auth/me').expect(401);
    await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer nonsense')
      .expect(401);
  });
});

describe('auth: register + login + validation', () => {
  it('registers, blocks duplicates, and logs in', async () => {
    await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'password123', displayName: 'Alice' })
      .expect(201);

    await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'password123', displayName: 'Alice2' })
      .expect(409);

    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'password123' })
      .expect(200);
    expect(login.body.user.email).toBe('alice@example.com');
    expect(login.body.user.isGuest).toBe(false);

    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'wrong-password' })
      .expect(401);
  });

  it('validates request bodies via the zod pipe', async () => {
    await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short', displayName: '' })
      .expect(400);
  });
});

describe('auth: refresh rotation + reuse detection', () => {
  it('rotates the refresh cookie and burns the family on reuse', async () => {
    const guest = await request(server()).post('/api/v1/auth/guest').send({}).expect(201);
    const c1 = refreshCookie(guest);
    expect(c1).toContain('trm_refresh=');

    const r1 = await request(server()).post('/api/v1/auth/refresh').set('Cookie', c1).expect(200);
    expect(r1.body.accessToken).toBeTruthy();
    const c2 = refreshCookie(r1);
    expect(c2).not.toBe(c1);

    // Re-presenting the now-rotated c1 = theft → family revoked.
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', c1).expect(401);
    // …which also invalidates the latest token c2.
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', c2).expect(401);
  });

  it('logout revokes the family', async () => {
    const guest = await request(server()).post('/api/v1/auth/guest').send({}).expect(201);
    const c = refreshCookie(guest);
    await request(server()).post('/api/v1/auth/logout').set('Cookie', c).expect(204);
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', c).expect(401);
  });
});

describe('auth: display preferences round-trip', () => {
  it('persists theme, colour-blind, language, and layout to the account', async () => {
    const reg = await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'prefs@example.com', password: 'password123', displayName: 'Prefs' })
      .expect(201);
    const token = reg.body.accessToken;
    const wanted = { theme: 'dark', colorBlind: true, locale: 'en', boardLayout: 'tray' };

    const patched = await request(server())
      .patch('/api/v1/auth/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send(wanted)
      .expect(200);
    expect(patched.body.preferences).toEqual(wanted);

    // A fresh /me (i.e. a later sign-in) must report the same stored preferences.
    const me = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.preferences).toEqual(wanted);
  });
});

describe('auth: guest → registered upgrade (keeps the same id)', () => {
  it('attaches credentials in place', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Guesty' })
      .expect(201);
    const { id } = guest.body.user;

    const up = await request(server())
      .post('/api/v1/auth/upgrade')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .send({ email: 'guesty@example.com', password: 'password123' })
      .expect(200);
    expect(up.body.user.id).toBe(id);
    expect(up.body.user.isGuest).toBe(false);
    expect(up.body.user.email).toBe('guesty@example.com');

    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'guesty@example.com', password: 'password123' })
      .expect(200);
  });
});

describe('auth: method gating (password + guest disabled)', () => {
  let g: TestApp;
  const gServer = () => g.app.getHttpServer();

  beforeAll(async () => {
    g = await createTestApp({ authConfig: { passwordLogin: false, guest: false } });
  }, 60_000);
  afterAll(() => g.close());

  it('advertises everything off via /config', async () => {
    const res = await request(gServer()).get('/api/v1/auth/config').expect(200);
    expect(res.body).toEqual({
      passwordLogin: false,
      guest: false,
      providers: { google: false, discord: false },
    });
  });

  it('rejects guest, register, and login with 403', async () => {
    await request(gServer()).post('/api/v1/auth/guest').send({}).expect(403);
    await request(gServer())
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.com', password: 'password123', displayName: 'X' })
      .expect(403);
    await request(gServer())
      .post('/api/v1/auth/login')
      .send({ email: 'x@example.com', password: 'password123' })
      .expect(403);
  });
});

describe('auth: OAuth (Google + Discord, bound by email)', () => {
  let o: TestApp;
  let fake: FakeOauthHttp;
  const oServer = () => o.app.getHttpServer();

  // Drive a full start→callback round-trip, threading the signed `state` + nonce cookie through.
  const runOauth = async (
    provider: 'google' | 'discord',
    profile: FakeOauthHttp['profile'],
    extra: { redirect?: string; refreshCookie?: string } = {},
  ) => {
    fake.profile = profile;
    fake.fail = false;
    const startReq = request(oServer())
      .get(`/api/v1/auth/oauth/${provider}/start`)
      .query(extra.redirect ? { redirect: extra.redirect } : {});
    if (extra.refreshCookie) startReq.set('Cookie', extra.refreshCookie);
    const start = await startReq.expect(302);
    const state = new URL(locationOf(start)).searchParams.get('state');
    const nonceCookie = pickCookie(start, 'trm_oauth');
    return request(oServer())
      .get(`/api/v1/auth/oauth/${provider}/callback`)
      .query({ code: 'auth-code', state })
      .set('Cookie', nonceCookie)
      .expect(302);
  };

  beforeAll(async () => {
    fake = new FakeOauthHttp();
    o = await createTestApp({ authConfig: OAUTH_TEST_CONFIG, oauthHttp: fake });
  }, 60_000);
  afterAll(() => o.close());

  it('advertises both providers via /config', async () => {
    const res = await request(oServer()).get('/api/v1/auth/config').expect(200);
    expect(res.body.providers).toEqual({ google: true, discord: true });
  });

  it('start issues the nonce cookie and redirects to the provider with state + PKCE', async () => {
    const start = await request(oServer())
      .get('/api/v1/auth/oauth/google/start')
      .query({ redirect: '/room/ABCD' })
      .expect(302);
    const loc = new URL(locationOf(start));
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('client_id')).toBe('gid');
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(loc.searchParams.get('code_challenge')).toBeTruthy();
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(pickCookie(start, 'trm_oauth')).toContain('trm_oauth=');
  });

  it('creates an account on first sign-in, stores the avatar, and the cookie authenticates /me', async () => {
    const cb = await runOauth(
      'google',
      {
        sub: 'g-1',
        email: 'New@Example.com',
        emailVerified: true,
        displayName: 'Newbie',
        avatarUrl: 'https://example.com/a/newbie.png',
      },
      { redirect: '/room/ABCD' },
    );
    expect(cb.headers.location).toContain('/login/callback');
    expect(cb.headers.location).toContain('redirect=');
    const refresh = refreshCookie(cb);
    expect(refresh).toContain('trm_refresh=');

    const r = await request(oServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refresh)
      .expect(200);
    const me = await request(oServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${r.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('new@example.com'); // normalized lowercase
    expect(me.body.isGuest).toBe(false);
    expect(me.body.avatarUrl).toBe('https://example.com/a/newbie.png');
  });

  it('does not 500 when the redirect query param is supplied more than once', async () => {
    const res = await request(oServer())
      .get('/api/v1/auth/oauth/google/start?redirect=/a&redirect=/b')
      .expect(302);
    // safeRedirect coerces the array to the '/' fallback; the flow still proceeds to the provider.
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('auto-links a second sign-in (same verified email) to the same account', async () => {
    // Pre-existing password account.
    const reg = await request(oServer())
      .post('/api/v1/auth/register')
      .send({ email: 'link@example.com', password: 'password123', displayName: 'Linker' })
      .expect(201);

    const cb = await runOauth('discord', {
      sub: 'd-1',
      email: 'link@example.com',
      emailVerified: true,
      displayName: 'Linker-Discord',
      avatarUrl: null,
    });
    const r = await request(oServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(cb))
      .expect(200);
    const me = await request(oServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${r.body.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(reg.body.user.id); // same account, bound by email
  });

  it('upgrades a signed-in guest in place (same id, keeps history)', async () => {
    const guest = await request(oServer())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'GuestG' })
      .expect(201);
    const cb = await runOauth(
      'google',
      {
        sub: 'g-2',
        email: 'guestg@example.com',
        emailVerified: true,
        displayName: 'GuestG',
        avatarUrl: 'https://example.com/a/guestg.png',
      },
      { refreshCookie: refreshCookie(guest) },
    );
    const r = await request(oServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(cb))
      .expect(200);
    const me = await request(oServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${r.body.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(guest.body.user.id);
    expect(me.body.isGuest).toBe(false);
    expect(me.body.email).toBe('guestg@example.com');
  });

  it('rejects an unverified provider email (no session issued)', async () => {
    const cb = await runOauth('discord', {
      sub: 'd-2',
      email: 'unverified@example.com',
      emailVerified: false,
      displayName: 'Unverified',
      avatarUrl: null,
    });
    expect(cb.headers.location).toContain('error=email_unverified');
    expect(refreshCookie(cb)).toBe('');
  });

  it('rejects a tampered nonce (CSRF guard)', async () => {
    fake.profile = {
      sub: 'g-3',
      email: 'csrf@example.com',
      emailVerified: true,
      displayName: 'C',
      avatarUrl: null,
    };
    const start = await request(oServer()).get('/api/v1/auth/oauth/google/start').expect(302);
    const state = new URL(locationOf(start)).searchParams.get('state');
    const cb = await request(oServer())
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', 'trm_oauth=not-the-real-nonce')
      .expect(302);
    expect(cb.headers.location).toContain('error=invalid_state');
    expect(refreshCookie(cb)).toBe('');
  });
});
