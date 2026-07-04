import { describe, it, expect } from 'vitest';
import type { PlayerId } from '@trm/shared';
import type { Board } from '../src/board';
import type { GameState } from '../src/types/state';
import { playGreedyGame } from './helpers';
import { legalActions } from '../src/selectors';
import { hasAnyLegalMove } from '../src/reduce';
import { currentPlayerId } from '../src/turn';

type Mode = 'light' | 'moderate' | 'intense';

/**
 * The single highest-risk invariant of M2: `hasAnyLegalMove`, the payment enumerators, and the
 * reducer's accept/reject gates must agree at EVERY reachable state, or PASS legality diverges and
 * players/bots strand. This walks full greedy games under every intensity and, before each action,
 * asserts:
 *   - the actor always has ≥1 legal action (never stranded), and
 *   - in AWAIT_ACTION, PASS is legal ⟺ there is no other legal move ⟺ hasAnyLegalMove is false,
 *     and when PASS is legal it is the SOLE legal action (the termination guarantee).
 */
function assertLegalityMirror(board: Board, state: GameState): void {
  const phase = state.turn.phase;
  let actor: PlayerId | undefined;
  if (phase === 'SETUP_TICKETS') {
    actor = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer);
  } else {
    actor = currentPlayerId(state);
  }
  if (!actor) return;

  const la = legalActions(board, state, actor);
  expect(la.length).toBeGreaterThan(0);

  if (phase === 'AWAIT_ACTION') {
    const hasPass = la.some((a) => a.t === 'PASS');
    expect(hasPass).toBe(!hasAnyLegalMove(board, state, actor));
    if (hasPass) expect(la.length).toBe(1); // PASS only when it is the only move
  }
}

describe('events property — legality mirror never diverges', () => {
  it('drives greedy games at every intensity with the accept/reject mirror agreeing at each state', () => {
    for (const mode of ['light', 'moderate', 'intense'] as Mode[]) {
      for (const np of [2, 3, 4]) {
        const r = playGreedyGame(np, `evt-prop-${mode}-${np}`, {
          ruleParams: { eventsMode: mode },
          onStep: assertLegalityMirror,
        });
        expect(r.finalState.turn.phase).toBe('GAME_OVER');
      }
    }
  });
});
