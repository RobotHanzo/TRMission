import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { RngState } from '@trm/shared';
import { makeRng, nextInt } from '@trm/shared';
import { makeConfig } from './helpers';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { legalActions } from '../src/selectors';
import { currentPlayerId } from '../src/turn';
import { checkInvariants } from '../src/invariants';
import { stateDigest } from '../src/serialize';
import type { GameState } from '../src/types/state';
import type { Action } from '../src/types/actions';

/** Pick a uniformly-random legal action (covers draws, tickets, stations, tunnels, passes). */
function randomLegalAction(board: ReturnType<typeof makeConfig>['board'], state: GameState, rng: RngState): [Action | null, RngState] {
  const phase = state.turn.phase;
  let actorList: Action[];
  if (phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer);
    if (!pid) return [null, rng];
    actorList = legalActions(board, state, pid);
  } else {
    actorList = legalActions(board, state, currentPlayerId(state));
  }
  if (actorList.length === 0) return [null, rng];
  const [i, next] = nextInt(rng, actorList.length);
  return [actorList[i] as Action, next];
}

describe('property: random legal play preserves all invariants', () => {
  it('conserves cards & trains across uniformly-random legal games', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 2, max: 5 }), (seed, numPlayers) => {
        const { board, config } = makeConfig(numPlayers, `prop-${seed}`);
        let state = initGame(board, config);
        let rng = makeRng(seed);
        for (let step = 0; step < 120 && state.turn.phase !== 'GAME_OVER'; step++) {
          const [action, nextRng] = randomLegalAction(board, state, rng);
          rng = nextRng;
          if (!action) break;
          const res = reduce(board, state, action);
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          state = res.value.state;
          const problems = checkInvariants(board, state);
          expect(problems).toEqual([]);
        }
      }),
      { numRuns: 25 },
    );
  });

  it('rejected actions never mutate the input state', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const { board, config } = makeConfig(3, `mut-${seed}`);
        const state = initGame(board, config);
        const before = stateDigest(state);
        // A grab-bag of likely-illegal actions for the SETUP_TICKETS phase.
        const bogus: Action[] = [
          { t: 'DRAW_BLIND', player: state.turnOrder[0]! },
          { t: 'CLAIM_ROUTE', player: state.turnOrder[1]!, routeId: 'R1' as never, payment: { color: 'RED', colorCount: 1, locomotives: 0 } },
          { t: 'PASS', player: state.turnOrder[0]! },
        ];
        for (const a of bogus) {
          const res = reduce(board, state, a);
          expect(res.ok).toBe(false);
        }
        expect(stateDigest(state)).toBe(before);
      }),
      { numRuns: 20 },
    );
  });
});
