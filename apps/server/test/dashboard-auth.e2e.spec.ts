import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();

/** Register a fresh account and return { userId, token }. */
async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

async function guest() {
  const res = await request(server())
    .post('/api/v1/auth/guest')
    .send({ displayName: 'Drifter' })
    .expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

const accounts = () => t.db.collection('dashboardAccounts');

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(() => t.close());

describe('dashboard guard posture', () => {
  it('401 without a token', async () => {
    await request(server()).get('/api/v1/dashboard/me').expect(401);
  });

  it('404 for a guest, even one granted a record (guests can never be maintainers)', async () => {
    const g = await guest();
    await request(server())
      .get('/api/v1/dashboard/me')
      .set('Authorization', `Bearer ${g.token}`)
      .expect(404);
  });

  it('404 for a registered user with no dashboard record', async () => {
    const u = await registered('nobody@example.com', 'Nobody');
    await request(server())
      .get('/api/v1/dashboard/me')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(404);
  });

  it('a maintainer reaches /me and sees role + effective permissions', async () => {
    const u = await registered('viewer@example.com', 'Vera');
    await accounts().insertOne({
      _id: u.userId,
      role: 'viewer',
      grantedBy: 'test',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const me = await request(server())
      .get('/api/v1/dashboard/me')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    expect(me.body.userId).toBe(u.userId);
    expect(me.body.role).toBe('viewer');
    expect(me.body.permissions).toContain('overview.read');
    expect(me.body.permissions).not.toContain('maintainers.write');
  });

  it('revocation is instant: deleting the record 404s the same token', async () => {
    const u = await registered('brief@example.com', 'Brie');
    await accounts().insertOne({
      _id: u.userId,
      role: 'admin',
      grantedBy: 'test',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);
    await request(server())
      .get('/api/v1/dashboard/me')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    await accounts().deleteOne({ _id: u.userId } as never);
    await request(server())
      .get('/api/v1/dashboard/me')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(404);
  });

  it('extra grants and denied revokes are reflected in effective permissions', async () => {
    const u = await registered('override@example.com', 'Ove');
    await accounts().insertOne({
      _id: u.userId,
      role: 'viewer',
      extraPermissions: ['games.terminate'],
      deniedPermissions: ['rooms.read'],
      grantedBy: 'test',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const me = await request(server())
      .get('/api/v1/dashboard/me')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    expect(me.body.permissions).toContain('games.terminate'); // extra beyond viewer
    expect(me.body.permissions).not.toContain('rooms.read'); // denied from viewer's base
  });
});
