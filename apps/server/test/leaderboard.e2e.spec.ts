import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service';
import { ALL_TIME_SCOPE, currentSeasonId, seasonScope } from '../src/leaderboard/season';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SEASON_SCOPE = seasonScope(currentSeasonId(new Date()));

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { token: res.body.accessToken, id: res.body.user.id as string };
}

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id as string };
}

/** Minimal matchHistory fixture — mirrors account-delete.e2e.spec.ts's injection pattern. */
async function insertMatch(
  gameId: string,
  players: { userId: string; seat: number }[],
  ranking: string[][],
  winners: string[],
) {
  await t.db.collection('matchHistory').insertOne({
    _id: gameId,
    players,
    turnOrder: players.map((p) => p.userId),
    seed: 'seed',
    contentHash: 'hash',
    finalScores: { players: [], ranking },
    winners,
    completedAt: new Date(),
  } as never);
}

let alice: { token: string; id: string };
let bob: { token: string; id: string };
let g: { token: string; id: string };

beforeAll(async () => {
  t = await createTestApp();
  alice = await registered('lb-alice@example.com', 'Alice');
  bob = await registered('lb-bob@example.com', 'Bob');
  g = await guest('LbGuest');
}, 60_000);
afterAll(() => t.close());

describe('LeaderboardService.onGameOver', () => {
  it('rates only registered humans; bots and guests never get a row', async () => {
    await insertMatch(
      'lb-game-1',
      [
        { userId: alice.id, seat: 0 },
        { userId: bob.id, seat: 1 },
        { userId: g.id, seat: 2 },
        { userId: 'bot:c1', seat: 3 },
      ],
      [[alice.id], [bob.id], [g.id], ['bot:c1']],
      [alice.id],
    );

    const svc = t.app.get(LeaderboardService);
    await svc.onGameOver('lb-game-1');

    const stats = t.db.collection('playerLeaderboardStats');
    const aliceAllTime = await stats.findOne({ _id: `${alice.id}:${ALL_TIME_SCOPE}` as never });
    const bobAllTime = await stats.findOne({ _id: `${bob.id}:${ALL_TIME_SCOPE}` as never });
    expect(aliceAllTime).toMatchObject({ gamesPlayed: 1, wins: 1, losses: 0 });
    expect(bobAllTime).toMatchObject({ gamesPlayed: 1, wins: 0, losses: 1 });
    expect(aliceAllTime!.rating).toBeGreaterThan(bobAllTime!.rating);

    // Same-season scope also updated.
    const aliceSeason = await stats.findOne({ _id: `${alice.id}:${SEASON_SCOPE}` as never });
    expect(aliceSeason).toMatchObject({ gamesPlayed: 1, wins: 1 });

    // Guest and bot never get a row.
    expect(await stats.countDocuments({ userId: g.id })).toBe(0);
    expect(await stats.countDocuments({ userId: 'bot:c1' })).toBe(0);
  });

  it('is idempotent — calling it again for the same game applies nothing further', async () => {
    const svc = t.app.get(LeaderboardService);
    await svc.onGameOver('lb-game-1');
    const aliceAllTime = await t.db
      .collection('playerLeaderboardStats')
      .findOne({ _id: `${alice.id}:${ALL_TIME_SCOPE}` as never });
    expect(aliceAllTime).toMatchObject({ gamesPlayed: 1, wins: 1 });
  });

  it('no-ops on a game with no matchHistory archive (e.g. maintainer-terminated)', async () => {
    const svc = t.app.get(LeaderboardService);
    await expect(svc.onGameOver('never-archived-game')).resolves.toBeUndefined();
  });
});

describe('GET /api/v1/leaderboard', () => {
  it('ranks the winner above the loser by rating, all-time', async () => {
    const res = await request(server())
      .get('/api/v1/leaderboard?scope=allTime&metric=rating')
      .set(auth(alice.token))
      .expect(200);
    const ids = res.body.rows.map((r: { userId: string }) => r.userId);
    expect(ids.indexOf(alice.id)).toBeLessThan(ids.indexOf(bob.id));
    const aliceRow = res.body.rows.find((r: { userId: string }) => r.userId === alice.id);
    expect(aliceRow.displayName).toBe('Alice');
    expect(aliceRow.rank).toBe(1);
  });

  it("GET /leaderboard/me returns the caller's own standing", async () => {
    const res = await request(server())
      .get('/api/v1/leaderboard/me?scope=allTime&metric=rating')
      .set(auth(bob.token))
      .expect(200);
    expect(res.body.standing.rank).toBe(2);
    expect(res.body.standing.wins).toBe(0);
    expect(res.body.standing.losses).toBe(1);
  });

  it('/leaderboard/me wraps a null standing (never a bare top-level null body)', async () => {
    const fresh = await registered('lb-fresh@example.com', 'Fresh');
    const res = await request(server())
      .get('/api/v1/leaderboard/me')
      .set(auth(fresh.token))
      .expect(200);
    expect(res.body).toEqual({ standing: null });
  });
});
