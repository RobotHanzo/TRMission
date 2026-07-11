// Destination-ticket rule helpers shared by the action reducer and the turn sequencer.
import type { PlayerId, TicketId } from '@trm/shared';
import type { Board } from './board';
import type { GameState } from './types/state';
import type { GameEvent } from './types/events';
import { ownConnectedTicketIds } from './graph/connectivity';
import { withPlayer } from './reducers/common';
import { ticketOfferCount } from './events/effects';

/**
 * Draw up to `ticketDrawCount` tickets off the short deck as an offer for `player`, moving the turn
 * into TICKET_SELECTION. Returns null when the short deck is empty (nothing can be drawn), so callers
 * decide whether that is an error (an explicit DRAW_TICKETS) or a silent no-op (the forced re-draw,
 * rule 7.5). The pop order matches the previous inline DRAW_TICKETS logic, so digests are unchanged.
 */
export function offerTickets(
  state: GameState,
  player: PlayerId,
): { state: GameState; events: GameEvent[] } | null {
  if (state.ticketDeckShort.length === 0) return null;
  const count = Math.min(ticketOfferCount(state), state.ticketDeckShort.length);
  const short = [...state.ticketDeckShort];
  const offered: TicketId[] = [];
  for (let i = 0; i < count; i++) {
    const t = short.pop();
    if (t) offered.push(t);
  }
  const next: GameState = {
    ...withPlayer(state, player, (pl) => ({ ...pl, pendingTicketOffer: offered })),
    ticketDeckShort: short,
    turn: { ...state.turn, phase: 'TICKET_SELECTION' },
  };
  return {
    state: next,
    events: [{ e: 'TICKETS_OFFERED', player, ticketIds: offered, visibility: { private: player } }],
  };
}

/**
 * Rule 7.5 predicate: true iff `player` holds at least one kept ticket and EVERY kept ticket is
 * already complete — either connected by their own track right now (own-edge connectivity,
 * knowable mid-game and monotonic) or already locked into `completedTickets` (the
 * `unlimitedStationBorrow` variant's station-borrow completion, also monotonic). Checking both
 * means this predicate is correct under either ruleset without branching on `ruleParams`: when the
 * variant is off, `completedTickets` stays permanently empty, so this reduces to the own-connected
 * check alone. Such a player has no objective left, so the turn sequencer forces them to draw new
 * tickets at the start of their turn.
 */
export function allKeptTicketsCompleted(board: Board, state: GameState, player: PlayerId): boolean {
  const p = state.players[player as string];
  if (!p || p.keptTickets.length === 0) return false;

  const ownEdges: { a: string; b: string }[] = [];
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell && cell.owner === player) {
      const r = board.routeById.get(routeId);
      if (r) ownEdges.push({ a: r.a as string, b: r.b as string });
    }
  }

  const tickets = p.keptTickets
    .map((tid) => {
      const t = board.ticketById.get(tid as string);
      return t ? { id: tid as string, a: t.a as string, b: t.b as string } : null;
    })
    .filter((x): x is { id: string; a: string; b: string } => x !== null);
  // A kept ticket without a definition should never happen — be conservative and don't force.
  if (tickets.length !== p.keptTickets.length) return false;

  const ownConnected = new Set(ownConnectedTicketIds({ ownEdges, tickets }));
  const completed = new Set(p.completedTickets as readonly string[]);
  return tickets.every((t) => ownConnected.has(t.id) || completed.has(t.id));
}
