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
import type { BotProfile, BotDifficulty } from '@trm/bots';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function waitForGameOver(phaseOf: () => string, maxTicks = 400_000): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (phaseOf() === 'GAME_OVER') return;
    await tick();
  }
  throw new Error('game did not terminate');
}

/**
 * A full 5-player table is where the "all routes claimed" endgame path lives: the map doesn't
 * have enough track for every seat to individually drain to the train-depletion threshold (see
 * packages/engine/test/engine.spec.ts), so these games routinely end via board exhaustion — every
 * player forced to PASS — rather than the train-depletion trigger. That path is proven correct in
 * the pure engine, but only the hub's bot driver (`GameHub.driveBots`) actually walks a live match
 * through it turn by turn; this test exercises that stack end-to-end so a future regression there
 * (or in the `legalActions`/`hasAnyLegalMove` parity it depends on) fails here, not in production.
 */
describe('bots: a full 5-bot table finishes, including via board exhaustion', () => {
  for (const seed of ['5p-a', '5p-b', '5p-c']) {
    it(`seed=${seed} reaches GAME_OVER and replays digit-for-digit`, async () => {
      const board = taiwanBoard();
      const seats: { id: string; difficulty: BotDifficulty }[] = [
        { id: 'bot:1', difficulty: 'EASY' },
        { id: 'bot:2', difficulty: 'MEDIUM' },
        { id: 'bot:3', difficulty: 'HARD' },
        { id: 'bot:4', difficulty: 'EASY' },
        { id: 'bot:5', difficulty: 'MEDIUM' },
      ];
      const players: PlayerSeed[] = seats.map((s, i) => ({
        id: asPlayerId(s.id),
        seat: i as SeatIndex,
      }));
      const bots: BotProfile[] = seats.map((s) => ({ playerId: s.id, difficulty: s.difficulty }));
      const config: GameConfig = { seed: `bots-5p-${seed}`, players, contentHash: CONTENT_HASH };

      const hub = new GameHub(new GameRegistry(), { botMoveDelayMs: 0 });
      const match = await hub.createMatch(`bots-5p-${seed}`, board, config, bots);
      const { session } = match;

      await waitForGameOver(() => session.phase);

      expect(session.phase).toBe('GAME_OVER');
      const scores = session.raw().finalScores;
      expect(scores?.players).toHaveLength(5);
      expect(scores?.ranking.length).toBeGreaterThan(0);

      const rep = replay(taiwanBoard(), config, session.appliedActions);
      expect(stateDigest(rep.state)).toBe(session.digest());
    }, 60_000);
  }
});
