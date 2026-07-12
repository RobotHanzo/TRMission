import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CONTENT_HASH } from '@trm/engine';
import { createTestApp, type TestApp } from './app';
import { HistoryRepo, REPLAY_COMPATIBLE_ENGINE_VERSIONS } from '../src/history/history.repo';
import type { MatchHistoryDoc } from '../src/persistence/types';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('history: replay-compat engine-version allowlist (plan risk R1)', () => {
  it('marks v9/v10 games replayable and a v8 game not (on a resolvable map)', async () => {
    const userId = 'u-compat';
    const now = Date.now();
    const base = {
      players: [{ userId, seat: 0 }],
      turnOrder: [userId],
      seed: 's',
      contentHash: CONTENT_HASH, // official Taiwan resolves synchronously → board build is not the gate
      finalScores: { players: [], ranking: [] },
      winners: [] as string[],
    };
    await t.db.collection<MatchHistoryDoc>('matchHistory').insertMany([
      { _id: 'g-v10', ...base, engineVersion: 10, completedAt: new Date(now) },
      { _id: 'g-v9', ...base, engineVersion: 9, completedAt: new Date(now - 1000) },
      { _id: 'g-v8', ...base, engineVersion: 8, completedAt: new Date(now - 2000) },
    ]);

    const rows = await t.app.get(HistoryRepo).listForUser(userId);
    const byId = new Map(rows.map((r) => [r.gameId, r]));
    expect(byId.get('g-v10')?.replayable).toBe(true);
    // v9 is in the allowlist AND its map still builds → replayable.
    expect(byId.get('g-v9')?.replayable).toBe(true);
    // v8 predates the v9 deadlock rule change → not replayable under v9.
    expect(byId.get('g-v8')?.replayable).toBe(false);
  });

  it('allowlists v9 plus the additive v10 END_GAME grammar', () => {
    expect(REPLAY_COMPATIBLE_ENGINE_VERSIONS).toEqual([9, 10]);
  });
});
