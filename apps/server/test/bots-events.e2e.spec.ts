import { describe, it, expect } from 'vitest';
import {
  taiwanBoard,
  replay,
  stateDigest,
  CONTENT_HASH,
  type GameConfig,
  type PlayerSeed,
} from '@trm/engine';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import type { BotProfile, BotDifficulty } from '../src/bots/types';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function waitForGameOver(phaseOf: () => string, maxTicks = 400_000): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (phaseOf() === 'GAME_OVER') return;
    await tick();
  }
  throw new Error('game did not terminate');
}

describe('bots: an all-bot INTENSE random-events table plays itself to a valid finish', () => {
  it('drives every phase (incl. closures / day-off / free-station) and replays digit-for-digit', async () => {
    const board = taiwanBoard();
    const seats: { id: string; difficulty: BotDifficulty }[] = [
      { id: 'bot:e', difficulty: 'EASY' },
      { id: 'bot:m', difficulty: 'MEDIUM' },
      { id: 'bot:h', difficulty: 'HARD' },
    ];
    const players: PlayerSeed[] = seats.map((s, i) => ({
      id: asPlayerId(s.id),
      seat: i as SeatIndex,
    }));
    const bots: BotProfile[] = seats.map((s) => ({ playerId: s.id, difficulty: s.difficulty }));
    const config: GameConfig = {
      seed: 'bots-events-intense',
      players,
      contentHash: CONTENT_HASH,
      ruleParams: { eventsMode: 'intense' },
    };

    // No human ever connects: createMatch kicks the driver and the bots run the whole game while
    // the seeded event schedule fires closures / day-off / free-station windows against legalActions.
    const hub = new GameHub(new GameRegistry(), { botMoveDelayMs: 0 });
    const match = await hub.createMatch('all-bots-events', board, config, bots);
    const { session } = match;

    await waitForGameOver(() => session.phase);

    expect(session.phase).toBe('GAME_OVER');
    // The feature really was on for the whole game (not silently downgraded).
    expect(session.raw().events?.mode).toBe('intense');
    const scores = session.raw().finalScores;
    expect(scores?.players).toHaveLength(3);
    expect(scores?.ranking.length).toBeGreaterThan(0);

    // Every bot move (and every event tick) is a logged action → a pure replay reaches the same state.
    const rep = replay(taiwanBoard(), config, session.appliedActions);
    expect(stateDigest(rep.state)).toBe(session.digest());
  }, 60_000);
});
