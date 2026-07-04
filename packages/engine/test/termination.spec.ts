import { describe, it, expect } from 'vitest';
import { playGreedyGame } from './helpers';
import { legalActions } from '../src/selectors';
import { currentPlayerId } from '../src/turn';

/**
 * Rule A15's termination guarantee (`PASS` is legal only when no other move is) depends on
 * `hasAnyLegalMove` and `legalActions`' candidate generation never diverging. If they ever did,
 * the acting player could be left with zero legal actions in AWAIT_ACTION/DRAWING_CARDS — which
 * the server's bot driver (`apps/server/src/ws/hub.ts`) cannot recover from on its own, since
 * nothing else will ever prompt that player's turn again. This is exercised hardest by full
 * (5-player) tables, where routes run out before any player's trains do (see engine.spec.ts).
 */
describe('termination guarantee: the acting player always has a legal action', () => {
  for (const numPlayers of [2, 3, 4, 5]) {
    it(`${numPlayers}-player greedy games never reach AWAIT_ACTION/DRAWING_CARDS with zero legal actions`, () => {
      for (const seed of ['a', 'b', 'c']) {
        playGreedyGame(numPlayers, `noact-${numPlayers}-${seed}`, {
          onStep: (board, state) => {
            if (state.turn.phase !== 'AWAIT_ACTION' && state.turn.phase !== 'DRAWING_CARDS') return;
            const acts = legalActions(board, state, currentPlayerId(state));
            expect(acts.length).toBeGreaterThan(0);
          },
        });
      }
    });
  }
});
