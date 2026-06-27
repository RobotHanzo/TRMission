import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import { makeConfig, playGreedyGame, taiwanBoard } from './helpers';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { redactFor } from '../src/selectors';
import type { GameState } from '../src/types/state';
import type { OwnerCell } from '../src/types/state';

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
    const board = taiwanBoard();
    const state = afterSetup(3, 'redact');
    const viewer = asPlayerId('p0');
    const view = redactFor(board, state, viewer);

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

    // The ONLY ticket ids structurally present in the per-player view are the viewer's own.
    const ownTickets = new Set(state.players[viewer as string]!.keptTickets.map((t) => t as string));
    const visibleTicketIds = new Set<string>();
    for (const p of view.players) {
      for (const t of p.keptTickets ?? []) visibleTicketIds.add(t as string);
      for (const t of p.pendingTicketOffer ?? []) visibleTicketIds.add(t as string);
    }
    for (const id of visibleTicketIds) expect(ownTickets.has(id)).toBe(true);
  });

  it('reveals no completed tickets before any routes are claimed', () => {
    const board = taiwanBoard();
    const state = afterSetup(2, 'complete-none');
    // Nobody has claimed a route yet → nothing is own-track connected.
    expect(redactFor(board, state, asPlayerId('p1')).completedTickets).toEqual([]);
  });

  it('reveals a player’s own-track completed tickets to EVERY viewer (in-progress stay secret)', () => {
    const board = taiwanBoard();
    const state = afterSetup(2, 'complete-all');
    const p0 = asPlayerId('p0');
    // Give p0 every route on the map → all of p0's kept tickets become own-track connected.
    const ownership: Record<string, OwnerCell> = {};
    for (const routeId of board.routeById.keys()) ownership[routeId] = { owner: p0 };
    const owned: GameState = { ...state, ownership };

    const p0Tickets = new Set(state.players[p0 as string]!.keptTickets.map((t) => t as string));
    expect(p0Tickets.size).toBeGreaterThan(0);

    // From an OPPONENT's view, p0's finished tickets are still revealed (public by design).
    const oppView = redactFor(board, owned, asPlayerId('p1'));
    const completedForP0 = new Set(
      oppView.completedTickets.filter((c) => (c.player as string) === 'p0').map((c) => c.ticket as string),
    );
    expect(completedForP0).toEqual(p0Tickets);
    // p1 owns nothing → none of p1's tickets are completed.
    expect(oppView.completedTickets.filter((c) => (c.player as string) === 'p1')).toEqual([]);

    // The reveal is viewer-independent: p0's own view lists the same completions.
    const selfView = redactFor(board, owned, p0);
    expect(new Set(selfView.completedTickets.map((c) => c.ticket as string))).toEqual(p0Tickets);
  });

  it('reveals all kept tickets at GAME_OVER', () => {
    const board = taiwanBoard();
    const { finalState } = playGreedyGame(3, 'redact-end');
    expect(finalState.turn.phase).toBe('GAME_OVER');
    const view = redactFor(board, finalState, asPlayerId('p1'));
    for (const p of view.players) {
      expect(p.keptTickets).not.toBeNull();
    }
    expect(view.finalScores).not.toBeNull();
  });

  it('a spectator (null viewer) sees no hands and no tickets pre-endgame', () => {
    const board = taiwanBoard();
    const state = afterSetup(2, 'spectator');
    const view = redactFor(board, state, null);
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
