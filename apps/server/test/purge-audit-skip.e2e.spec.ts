import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { PurgeService } from '../src/dashboard/purge.service';
import type { AuthUser } from '../src/auth/auth.types';

let t: TestApp;
const actor = { userId: 'op-1', displayName: 'Operator' } as AuthUser;
const countRuns = () =>
  t.db.collection('dashboardAudit').countDocuments({ action: 'purge.run' } as never);

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('purge no-op audit skip', () => {
  it('an auto sweep that deletes nothing writes no purge.run audit entry', async () => {
    const purge = t.app.get(PurgeService);
    const before = await countRuns();
    const summary = await purge.runSweep('auto');
    expect(summary.roomsDeleted).toBe(0);
    expect(summary.gamesDeleted).toBe(0);
    expect(await countRuns()).toBe(before);
  });

  it('a manual sweep that deletes nothing still writes one purge.run audit entry', async () => {
    const purge = t.app.get(PurgeService);
    const before = await countRuns();
    const summary = await purge.runSweep('manual', actor);
    expect(summary.roomsDeleted).toBe(0);
    expect(summary.gamesDeleted).toBe(0);
    expect(await countRuns()).toBe(before + 1);
  });

  it('an auto sweep that deletes a stale room still writes a purge.run audit entry', async () => {
    const stale = new Date(Date.now() - 72 * 3_600_000);
    await t.db.collection('rooms').insertOne({
      _id: 'STALE1',
      hostId: 'nobody',
      status: 'LOBBY',
      members: [],
      maxPlayers: 5,
      settings: {},
      createdAt: stale,
      updatedAt: stale,
    } as never);
    const purge = t.app.get(PurgeService);
    const before = await countRuns();
    const summary = await purge.runSweep('auto');
    expect(summary.roomsDeleted).toBe(1);
    expect(await countRuns()).toBe(before + 1);
  });
});
