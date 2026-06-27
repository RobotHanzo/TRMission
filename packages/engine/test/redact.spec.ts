import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import { makeConfig, playGreedyGame } from './helpers';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { redactFor } from '../src/selectors';
import type { GameState } from '../src/types/state';

/** Resolve every player's initial ticket offer (keep the minimum) → AWAIT_ACTION. */
function afterSetup(numPlayers: number, seed: string): GameState {
  const { board, config } = makeConfig(numPlayers, seed);
  let state = initGame(board, config);
  while (state.turn.phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer);
    const offer = state.players[pid as string]!.pendingTicketOffer!;
    const res = reduce(board, state, {
      t: 'KEEP_INITIAL_TICKETS',
      player: pid!,
      keep: offer.slice(0, state.ruleParams.minKeepInitial),
    });
    if (!res.ok) throw new Error('setup keep failed');
    state = res.value.state;
  }
  return state;
}

describe('redactFor — hidden information', () => {
  it('never exposes opponents’ hands or kept tickets mid-game', () => {
    const state = afterSetup(3, 'redact');
    const viewer = asPlayerId('p0');
    const view = redactFor(state, viewer);

    const self = view.players.find((p) => p.id === viewer)!;
    expect(self.hand).not.toBeNull();
    expect(self.keptTickets).not.toBeNull();

    for (const opp of view.players.filter((p) => p.id !== viewer)) {
      expect(opp_hand(opp)).toBeNull();
      expect(opp.keptTickets).toBeNull();
      expect(opp.pendingTicketOffer).toBeNull();
      // Counts ARE public.
      expect(opp.handCount).toBeGreaterThan(0);
      expect(opp.ticketCount).toBeGreaterThanOrEqual(2);
    }

    // The ONLY ticket ids structurally present in the view are the viewer's own.
    const ownTickets = new Set(state.players[viewer as string]!.keptTickets.map((t) => t as string));
    const visibleTicketIds = new Set<string>();
    for (const p of view.players) {
      for (const t of p.keptTickets ?? []) visibleTicketIds.add(t as string);
      for (const t of p.pendingTicketOffer ?? []) visibleTicketIds.add(t as string);
    }
    for (const id of visibleTicketIds) expect(ownTickets.has(id)).toBe(true);
  });

  it('reveals all kept tickets at GAME_OVER', () => {
    const { finalState } = playGreedyGame(3, 'redact-end');
    expect(finalState.turn.phase).toBe('GAME_OVER');
    const view = redactFor(finalState, asPlayerId('p1'));
    for (const p of view.players) {
      expect(p.keptTickets).not.toBeNull();
    }
    expect(view.finalScores).not.toBeNull();
  });

  it('a spectator (null viewer) sees no hands and no tickets pre-endgame', () => {
    const state = afterSetup(2, 'spectator');
    const view = redactFor(state, null);
    for (const p of view.players) {
      expect(opp_hand(p)).toBeNull();
      expect(p.keptTickets).toBeNull();
    }
  });
});

// Helper to read the (possibly null) hand without tripping the no-non-null-assertion lint.
function opp_hand(p: { hand: unknown }): unknown {
  return p.hand;
}
