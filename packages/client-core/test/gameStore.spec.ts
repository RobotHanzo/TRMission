import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGameStore } from '../src/store/game';

describe('game store: per-turn countdown (issue #13)', () => {
  afterEach(() => vi.useRealTimers());

  it('anchors a client-local deadline from the pushed remaining time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const store = createGameStore();
    store.getState().applyTurnTimer('p1', 60_000, 75_000);
    expect(store.getState().turnTimer).toEqual({
      playerId: 'p1',
      deadline: 1_060_000,
      totalMs: 75_000,
    });
  });

  it('clears the countdown when the server sends an empty player (bot turn / game over)', () => {
    const store = createGameStore();
    store.getState().applyTurnTimer('p1', 60_000, 75_000);
    expect(store.getState().turnTimer).not.toBeNull();
    store.getState().applyTurnTimer('', 0, 75_000);
    expect(store.getState().turnTimer).toBeNull();
  });

  it('reset() drops any active countdown', () => {
    const store = createGameStore();
    store.getState().applyTurnTimer('p1', 5_000, 75_000);
    store.getState().reset();
    expect(store.getState().turnTimer).toBeNull();
  });
});
