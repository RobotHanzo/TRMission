import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { token: res.body.accessToken, id: res.body.user.id as string };
}

async function grantDashboard(userId: string, role: 'viewer' | 'admin') {
  await t.db.collection('dashboardAccounts').insertOne({
    _id: userId,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

let viewer: { token: string; id: string };
let rater: { token: string; id: string };

beforeAll(async () => {
  t = await createTestApp();
  viewer = await registered('rviewer@example.com', 'Viewer');
  await grantDashboard(viewer.id, 'viewer');
  rater = await registered('rater@example.com', 'Rater');

  await request(server())
    .post('/api/v1/ratings')
    .set(auth(rater.token))
    .send({ gameId: 'g1', roomId: 'ABCDE', stars: 4 })
    .expect(201);
  await request(server())
    .post('/api/v1/ratings')
    .set(auth(rater.token))
    .send({ gameId: 'g2', roomId: 'FGHIJ', stars: 2 })
    .expect(201);
}, 60_000);
afterAll(() => t.close());

describe('GET /dashboard/ratings', () => {
  it('403s without ratings.read', async () => {
    const noPerm = await registered('rnoperm@example.com', 'NoPerm');
    await request(server()).get('/api/v1/dashboard/ratings').set(auth(noPerm.token)).expect(404);
  });

  it('lists ratings with display names, average, and total count (viewer permission)', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/ratings')
      .set(auth(viewer.token))
      .expect(200);
    expect(res.body.ratings.length).toBeGreaterThanOrEqual(2);
    expect(res.body.totalCount).toBeGreaterThanOrEqual(2);
    expect(res.body.avgStars).toBe(3);
    const row = res.body.ratings.find((r: { gameId: string }) => r.gameId === 'g1');
    expect(row.userDisplayName).toBe('Rater');
    expect(row.stars).toBe(4);
    expect(res.body).toHaveProperty('nextCursor');
  });
});
