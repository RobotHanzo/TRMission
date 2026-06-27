import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, refreshCookie, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(() => t.close());

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
