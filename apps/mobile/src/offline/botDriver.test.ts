import { taiwanBoard } from '@trm/engine';
import type { GameEvent } from '@trm/engine';
import { LocalGameSession } from './localGameSession';
import { InMemoryLocalGameStore } from './inMemoryStore';
import { newOfflineSetup } from './newGame';
import { runBotBurst } from './botDriver';
import { BOT_STEP_MS, botPauseMs } from './pacing';

describe('runBotBurst', () => {
  it('drives every actable bot, pacing before each move, then yields to the human', async () => {
    const store = new InMemoryLocalGameStore();
    const session = await LocalGameSession.create(
      newOfflineSetup({
        mapId: 'taiwan',
        botCount: 2,
        difficulty: 'MEDIUM',
        gameId: 'local:bd-1',
        seed: 'driver-spec',
      }),
      taiwanBoard(),
      store,
    );

    const delays: number[] = [];
    const batches: GameEvent[][] = [];
    await runBotBurst(session, {
      onBotMove: (events) => batches.push(events),
      delay: async (ms) => {
        delays.push(ms);
      },
      isCancelled: () => false,
    });

    // Setup phase: both bots keep their initial tickets; then the burst stops (human pending).
    expect(batches.length).toBe(2);
    expect(delays.length).toBe(2);
    expect(delays.every((d) => d >= BOT_STEP_MS)).toBe(true);
    expect(session.nextActableBot()).toBeNull();
    expect(session.isGameOver).toBe(false);
  });

  it('cancellation stops the loop before the next move', async () => {
    const store = new InMemoryLocalGameStore();
    const session = await LocalGameSession.create(
      newOfflineSetup({
        mapId: 'taiwan',
        botCount: 2,
        difficulty: 'EASY',
        gameId: 'local:bd-2',
        seed: 'driver-spec-2',
      }),
      taiwanBoard(),
      store,
    );
    let moves = 0;
    await runBotBurst(session, {
      onBotMove: () => {
        moves++;
      },
      delay: async () => {},
      isCancelled: () => moves >= 1, // cancel after the first applied move
    });
    expect(moves).toBe(1);
  });
});

describe('botPauseMs', () => {
  it('is the base pace outside tunnels and stretches for tunnel reveals', () => {
    expect(botPauseMs('AWAIT_ACTION', 0)).toBe(BOT_STEP_MS);
    expect(botPauseMs('TUNNEL_PENDING', 3)).toBeGreaterThan(BOT_STEP_MS);
  });
});
