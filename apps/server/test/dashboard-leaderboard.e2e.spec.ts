import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service';

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
let winner: { token: string; id: string };
let loser: { token: string; id: string };

beforeAll(async () => {
  t = await createTestApp();
  viewer = await registered('lbd-viewer@example.com', 'Viewer');
  await grantDashboard(viewer.id, 'viewer');
  winner = await registered('lbd-winner@example.com', 'Winner');
  loser = await registered('lbd-loser@example.com', 'Loser');

  await t.db.collection('matchHistory').insertOne({
    _id: 'lbd-game-1',
    players: [
      { userId: winner.id, seat: 0 },
      { userId: loser.id, seat: 1 },
    ],
    turnOrder: [winner.id, loser.id],
    seed: 'seed',
    contentHash: 'hash',
    finalScores: { players: [], ranking: [[winner.id], [loser.id]] },
    winners: [winner.id],
    completedAt: new Date(),
  } as never);
  await t.app.get(LeaderboardService).onGameOver('lbd-game-1');
}, 60_000);
afterAll(() => t.close());

describe('GET /dashboard/leaderboard', () => {
  it('404s without any dashboard access (nondisclosing)', async () => {
    const noPerm = await registered('lbd-noperm@example.com', 'NoPerm');
    await request(server())
      .get('/api/v1/dashboard/leaderboard')
      .set(auth(noPerm.token))
      .expect(404);
  });

  it('lists standings with display names (viewer permission)', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/leaderboard?scope=allTime&metric=rating')
      .set(auth(viewer.token))
      .expect(200);
    expect(res.body).toHaveProperty('nextCursor');
    const ids = res.body.rows.map((r: { userId: string }) => r.userId);
    expect(ids.indexOf(winner.id)).toBeLessThan(ids.indexOf(loser.id));
    const row = res.body.rows.find((r: { userId: string }) => r.userId === winner.id);
    expect(row.displayName).toBe('Winner');
    expect(row.wins).toBe(1);
  });
});
