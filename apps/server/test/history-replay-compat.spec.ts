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
  it('marks a v4-stamped game replayable and a v3-stamped game not (on a resolvable map)', async () => {
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
      { _id: 'g-v4', ...base, engineVersion: 4, completedAt: new Date(now - 1000) },
      { _id: 'g-v3', ...base, engineVersion: 3, completedAt: new Date(now - 2000) },
    ]);

    const rows = await t.app.get(HistoryRepo).listForUser(userId);
    const byId = new Map(rows.map((r) => [r.gameId, r]));
    // v4 is in the allowlist AND its map still builds → replayable.
    expect(byId.get('g-v4')?.replayable).toBe(true);
    // v3 predates the allowlist → not replayable, regardless of the map resolving.
    expect(byId.get('g-v3')?.replayable).toBe(false);
  });

  it('allowlists the current + previous engine majors, but not older ones', () => {
    expect(REPLAY_COMPATIBLE_ENGINE_VERSIONS).toContain(4);
    expect(REPLAY_COMPATIBLE_ENGINE_VERSIONS).toContain(5);
    expect(REPLAY_COMPATIBLE_ENGINE_VERSIONS).not.toContain(3);
  });
});
