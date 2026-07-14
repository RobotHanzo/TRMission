import type { Action, Board, GameState } from '@trm/engine';
import { legalActions } from '@trm/engine';
import type { PlayerId } from '@trm/shared';

/**
 * The single human-or-bot player the game is currently waiting on to act, or null when there is no
 * such player. Every phase except two has exactly one actor — the current player (AWAIT_ACTION /
 * DRAWING_CARDS / TICKET_SELECTION / EVENT_DRAFT / HIVE_DRAW), or, for a mid-turn interrupt, whoever
 * must resolve it (TUNNEL_PENDING / LANTERN_RELOCATION), which is still the current player since the
 * turn has not advanced. GAME_OVER has no actor; SETUP_TICKETS is a *simultaneous* phase (several
 * players choose at once) that the single per-turn timer deliberately does not cover.
 */
export function turnActor(state: GameState): PlayerId | null {
  const phase = state.turn.phase;
  if (phase === 'GAME_OVER' || phase === 'SETUP_TICKETS') return null;
  return (state.turnOrder[state.turn.orderIndex] as PlayerId | undefined) ?? null;
}

/**
 * The default action to auto-play when a player's per-turn timer lapses (issue #13). Always a move
 * the reducer accepts — it is picked from `legalActions`, so a timeout can never inject an illegal
 * action (the same invariant the bot driver relies on) and the injected move replays like any other
 * logged action. Priority, matching the issue's "take a random train card, if forced to a mission
 * take all":
 *
 *   1. Forced ticket selection → keep ALL offered tickets.
 *   2. Take a random train card → a blind draw off the deck top.
 *   3. Deck exhausted → take any face-up card (still a train card).
 *   4. A pending tunnel → abort it (never force the player to over-pay to commit).
 *   5. A Hive push-your-luck draw → stop (bank what's drawn rather than gamble on).
 *   6. A mandatory event-perk draft / Lantern relocation → its first legal option.
 *   7. Nothing productive remains → PASS.
 *
 * Returns null only when the player has no legal action at all — unreachable for the current player,
 * since PASS is guaranteed legal whenever nothing else is (rule A15).
 */
export function chooseTimeoutAction(
  board: Board,
  state: GameState,
  player: PlayerId,
): Action | null {
  const legal = legalActions(board, state, player);
  if (legal.length === 0) return null;

  // 1) Forced ticket keep → the option that keeps the most tickets (the full offer is always among
  //    the enumerated subsets, so "keep the most" resolves to "keep all").
  const keeps = legal.filter(
    (a): a is Extract<Action, { t: 'KEEP_TICKETS' | 'KEEP_INITIAL_TICKETS' }> =>
      a.t === 'KEEP_TICKETS' || a.t === 'KEEP_INITIAL_TICKETS',
  );
  if (keeps.length > 0) {
    return keeps.reduce((best, a) => (a.keep.length > best.keep.length ? a : best));
  }

  const firstOf = (t: Action['t']): Action | undefined => legal.find((a) => a.t === t);

  return (
    // 2) take a random train card, 3) or any face-up if the deck is empty.
    firstOf('DRAW_BLIND') ??
    firstOf('DRAW_FACEUP') ??
    // 4) abort a pending tunnel (commit:false is the no-extra-cost resolution).
    legal.find((a) => a.t === 'RESOLVE_TUNNEL' && a.commit === false) ??
    // 5) stop a Hive push-your-luck draw.
    firstOf('STOP_HIVE_DRAW') ??
    // 6) resolve a mandatory draft / relocation with its first legal option.
    firstOf('CHOOSE_EVENT_PERK') ??
    firstOf('RELOCATE_LANTERN_HOST') ??
    // 7) last resort — legal only when nothing else is.
    firstOf('PASS') ??
    legal[0] ??
    null
  );
}
