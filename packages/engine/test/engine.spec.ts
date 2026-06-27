import { describe, it, expect } from 'vitest';
import { makeConfig, playGreedyGame } from './helpers';
import { initGame } from '../src/setup';
import { replay, stateDigest } from '../src/serialize';
import { checkInvariants } from '../src/invariants';

describe('initGame', () => {
  it('deals starting hands, market, and initial ticket offers', () => {
    const { board, config } = makeConfig(3, 'setup-seed');
    const state = initGame(board, config);
    expect(state.turn.phase).toBe('SETUP_TICKETS');
    expect(state.turnOrder).toHaveLength(3);
    expect(state.market.filter((c) => c !== null)).toHaveLength(5);
    for (const id of state.turnOrder) {
      const p = state.players[id as string]!;
      const handTotal = Object.values(p.hand).reduce((a, b) => a + b, 0);
      expect(handTotal).toBe(config.ruleParams?.handStart ?? 4);
      expect(p.trainCars).toBe(45);
      expect(p.stationsRemaining).toBe(3);
      // 1 long + 3 short offered.
      expect(p.pendingTicketOffer).toHaveLength(4);
    }
    expect(checkInvariants(board, state)).toEqual([]);
  });

  it('is deterministic: same seed → identical genesis digest', () => {
    const a = makeConfig(4, 'same');
    const b = makeConfig(4, 'same');
    expect(stateDigest(initGame(a.board, a.config))).toBe(stateDigest(initGame(b.board, b.config)));
  });

  it('different seeds → different genesis', () => {
    const a = makeConfig(4, 'seed-a');
    const b = makeConfig(4, 'seed-b');
    expect(stateDigest(initGame(a.board, a.config))).not.toBe(stateDigest(initGame(b.board, b.config)));
  });
});

describe('full games (greedy policy)', () => {
  for (const numPlayers of [2, 3, 4, 5]) {
    it(`${numPlayers}-player game reaches GAME_OVER with invariants holding throughout`, () => {
      const { finalState, log } = playGreedyGame(numPlayers, `game-${numPlayers}`);
      expect(finalState.turn.phase).toBe('GAME_OVER');
      expect(finalState.finalScores).not.toBeNull();
      expect(finalState.finalScores!.players).toHaveLength(numPlayers);
      // The game must terminate cleanly. Smaller tables drive a player down to ≤2 trains
      // (the train-depletion endgame); but on the reduced one-station-per-county map there
      // isn't enough track for a full 5-player table to do so, so it terminates by board
      // exhaustion (every player forced to PASS) instead — still a valid GAME_OVER.
      if (numPlayers <= 4) expect(finalState.endgame.triggered).toBe(true);
      expect(log.length).toBeGreaterThan(numPlayers * 5);
    });
  }

  it('replays byte-identically from seed + action log (determinism)', () => {
    const { board, config } = makeConfig(3, 'replay-1');
    const { finalState, log } = playGreedyGame(3, 'replay-1');
    const replayed = replay(board, config, log);
    expect(stateDigest(replayed.state)).toBe(stateDigest(finalState));
  });

  it('same seed → same final score; the policy is reproducible', () => {
    const a = playGreedyGame(4, 'repro');
    const b = playGreedyGame(4, 'repro');
    expect(stateDigest(a.finalState)).toBe(stateDigest(b.finalState));
  });
});
