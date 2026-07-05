import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { Db } from 'mongodb';
import { env } from '../src/config/env';
import { PurgeService } from '../src/dashboard/purge.service';
import type { GameRegistry } from '../src/game/game-registry';
import type { GameHub } from '../src/ws/hub';
import type { RoomRepo } from '../src/lobby/room.repo';
import type { AuditService } from '../src/dashboard/audit.service';
import type { DashboardAuditRepo } from '../src/dashboard/audit.repo';
import type { MetricsService } from '../src/observability/metrics.service';

// Lightweight, DI-free construction: onModuleInit only ever touches env + this.runSweep, so the
// other collaborators can stay unused stand-ins (mirrors the direct-construction style already
// used by test/connection.spec.ts for GameHub).
function makeService(): PurgeService {
  const fakeDb = { collection: () => ({}) } as unknown as Db;
  return new PurgeService(
    fakeDb,
    {} as GameRegistry,
    {} as GameHub,
    {} as RoomRepo,
    {} as AuditService,
    {} as DashboardAuditRepo,
    {} as MetricsService,
  );
}

describe('PurgeService.onModuleInit auto-sweep scheduling', () => {
  const originalAutoEnabled = env.purgeAutoEnabled;
  const originalIntervalMs = env.purgeIntervalMs;

  afterEach(() => {
    Object.assign(env, {
      purgeAutoEnabled: originalAutoEnabled,
      purgeIntervalMs: originalIntervalMs,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('catches a rejected auto sweep and logs it instead of raising an unhandled rejection', async () => {
    Object.assign(env, { purgeAutoEnabled: true, purgeIntervalMs: 5 });
    const service = makeService();
    const sweepError = new Error('mongo blip');
    vi.spyOn(service, 'runSweep').mockRejectedValue(sweepError);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      vi.useFakeTimers();
      expect(() => service.onModuleInit()).not.toThrow();
      await vi.advanceTimersByTimeAsync(5);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      service.onModuleDestroy();
    }

    expect(service.runSweep).toHaveBeenCalledWith('auto');
    expect(errorSpy).toHaveBeenCalledWith('auto-purge sweep failed', sweepError);
    expect(unhandled).toEqual([]);
  });
});
