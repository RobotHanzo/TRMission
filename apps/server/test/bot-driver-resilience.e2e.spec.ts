import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type GameConfig, type PlayerSeed } from '@trm/engine';
import type { GameState } from '@trm/engine';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import type { BotProfile } from '../src/bots/types';
import type { MetricsHooks } from '../src/observability/hooks';
import type { ChatEntry, GameStorePort } from '../src/persistence/types';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function waitUntil(pred: () => boolean, maxTicks = 50_000): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return;
    await tick();
  }
  throw new Error('condition never became true');
}

/**
 * A store whose `appendAction` throws for the first `failures` calls, then behaves (no-op
 * persist — these tests only care about the hub's reaction, not real durability).
 */
class FlakyStore implements GameStorePort {
  appendCount = 0;
  constructor(private failures: number) {}
  async createGame(): Promise<void> {}
  async appendAction(): Promise<void> {
    this.appendCount++;
    if (this.failures > 0) {
      this.failures--;
      throw new Error('injected persist failure');
    }
  }
  async recordCompletion(): Promise<void> {}
  async getStatus(): Promise<undefined> {
    return undefined;
  }
  async addSpectator(): Promise<void> {}
  async loadForRecovery(): Promise<null> {
    return null;
  }
  async appendChat(): Promise<void> {}
  async loadChat(): Promise<ChatEntry[]> {
    return [];
  }
}

function stallCounter(): {
  stalls: { no_legal_action: number; persist_failed: number };
  metrics: MetricsHooks;
} {
  const stalls = { no_legal_action: 0, persist_failed: 0 };
  const metrics: MetricsHooks = {
    commandReceived() {},
    commandRejected() {},
    commandApplied() {},
    connectionOpened() {},
    connectionClosed() {},
    leakBlocked() {},
    botDriverStalled(reason) {
      stalls[reason] += 1;
    },
  };
  return { stalls, metrics };
}

function allBotConfig(gameId: string): { config: GameConfig; bots: BotProfile[] } {
  const seats: BotProfile[] = [
    { playerId: 'bot:1', difficulty: 'EASY' },
    { playerId: 'bot:2', difficulty: 'MEDIUM' },
    { playerId: 'bot:3', difficulty: 'HARD' },
  ];
  const players: PlayerSeed[] = seats.map((s, i) => ({
    id: asPlayerId(s.playerId),
    seat: i as SeatIndex,
  }));
  return { config: { seed: `flaky-${gameId}`, players, contentHash: CONTENT_HASH }, bots: seats };
}

describe('bot driver resilience: transient persist failures never permanently freeze a match', () => {
  it('absorbs a couple of transient persist failures via in-process retry, with no reschedule', async () => {
    const board = taiwanBoard();
    const { config, bots } = allBotConfig('retry-ok');
    const store = new FlakyStore(2); // fewer failures than the retry budget
    const { stalls, metrics } = stallCounter();

    const hub = new GameHub(new GameRegistry(), {
      store,
      metrics,
      botMoveDelayMs: 0,
      botPersistRetryDelayMs: 0,
      botDriverRescheduleMs: 5,
    });
    const match = await hub.createMatch('retry-ok', board, config, bots);

    // The very first bot move hit 2 injected failures and still got applied via retry.
    await waitUntil(() => match.session.raw().actionSeq > 0);
    expect(store.appendCount).toBeGreaterThanOrEqual(3); // 2 failed attempts + 1 that stuck
    expect(stalls.persist_failed).toBe(0);
  });

  it('reschedules the driver after persist retries are exhausted, and self-heals once the store recovers', async () => {
    const board = taiwanBoard();
    const { config, bots } = allBotConfig('retry-exhausted');
    // More failures than the default retry budget (3): the first drive pass gives up and
    // reschedules; by the time it fires again the store has recovered.
    const store = new FlakyStore(5);
    const { stalls, metrics } = stallCounter();

    const hub = new GameHub(new GameRegistry(), {
      store,
      metrics,
      botMoveDelayMs: 0,
      botPersistRetryDelayMs: 0,
      botDriverRescheduleMs: 5,
    });
    const match = await hub.createMatch('retry-exhausted', board, config, bots);

    await waitUntil(() => stalls.persist_failed >= 1);
    // Nobody else will ever prompt this bot again — only the scheduled re-drive can recover it.
    const stateBefore: GameState = match.session.raw();
    expect(stateBefore.actionSeq).toBe(0);

    await waitUntil(() => match.session.raw().actionSeq > 0);
    expect(store.appendCount).toBeGreaterThan(5); // recovered and kept going past the flaky window
  });
});
