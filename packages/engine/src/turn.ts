import type { PlayerId } from '@trm/shared';
import type { Board } from './board';
import type { GameState } from './types/state';
import type { GameEvent } from './types/events';
import { computeFinalScores } from './scoring';
import { offerTickets, allKeptTicketsCompleted } from './tickets';
import { tickRound } from './events/runtime';

export function currentPlayerId(state: GameState): PlayerId {
  return state.turnOrder[state.turn.orderIndex] as PlayerId;
}

export interface TurnOutcome {
  readonly state: GameState;
  readonly events: GameEvent[];
}

/**
 * Finalize the acting player's turn: run the endgame trigger / final-round countdown and the
 * all-PASS termination rule (A15), then either end the game (computing final scores) or advance
 * to the next player. The turn's own effects must already be applied to `state`.
 */
export function endTurn(board: Board, state: GameState, opts: { wasPass: boolean }): TurnOutcome {
  const events: GameEvent[] = [];
  const n = state.turnOrder.length;
  const curIdx = state.turn.orderIndex;
  const curPlayer = state.turnOrder[curIdx] as PlayerId;
  const player = state.players[curPlayer as string];

  const consecutivePasses = opts.wasPass ? state.consecutivePasses + 1 : 0;

  let endgame = state.endgame;
  let triggeredNow = false;
  if (
    !endgame.triggered &&
    (player?.trainCars ?? Infinity) <= state.ruleParams.endgameTrainThreshold
  ) {
    endgame = { triggered: true, triggerPlayerIndex: curIdx, finalTurnsRemaining: n };
    triggeredNow = true;
    events.push({
      e: 'ENDGAME_TRIGGERED',
      player: curPlayer,
      finalTurnsRemaining: n,
      visibility: 'PUBLIC',
    });
  } else if (endgame.triggered) {
    endgame = { ...endgame, finalTurnsRemaining: endgame.finalTurnsRemaining - 1 };
  }

  events.push({ e: 'TURN_ENDED', player: curPlayer, visibility: 'PUBLIC' });

  const allPassEnd = consecutivePasses >= n;
  const endgameEnd = endgame.triggered && !triggeredNow && endgame.finalTurnsRemaining <= 0;

  if (allPassEnd || endgameEnd) {
    const ended: GameState = {
      ...state,
      consecutivePasses,
      endgame,
      turn: { ...state.turn, phase: 'GAME_OVER' },
    };
    const finalScores = computeFinalScores(board, ended);
    events.push({ e: 'GAME_ENDED', visibility: 'PUBLIC' });
    return { state: { ...ended, finalScores }, events };
  }

  const nextIdx = (curIdx + 1) % n;
  const nextPlayer = state.turnOrder[nextIdx] as PlayerId;
  let next: GameState = {
    ...state,
    consecutivePasses,
    endgame,
    turn: { orderIndex: nextIdx, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 },
  };

  // Random-events round tick. Runs ONLY when the feature is on AND the turn order just wrapped
  // (nextIdx === 0 → a full round completed). We are past the termination early-return, so this
  // never fires on the game-ending turn. The caller (here) owns the roundIndex increment: bump it
  // before ticking so tickRound sees the round about to be played. Emitted order:
  //   TURN_ENDED (already pushed), EVENT_ENDED*, EVENT_STARTED* (+gala draws), EVENT_ANNOUNCED?,
  //   then TURN_STARTED — with rule-7.5's forced draw staying LAST, on the post-tick state.
  if (next.events && nextIdx === 0) {
    const bumped: GameState = {
      ...next,
      events: { ...next.events, roundIndex: next.events.roundIndex + 1 },
    };
    const tick = tickRound(board, bumped);
    next = tick.state;
    events.push(...tick.events);
  }

  events.push({ e: 'TURN_STARTED', player: nextPlayer, orderIndex: nextIdx, visibility: 'PUBLIC' });

  // Rule 7.5 — forced ticket re-draw: a player whose every kept ticket is already complete (own
  // track, or — under unlimitedStationBorrow — already locked via station-borrow completion) has
  // no objective left, so their turn opens straight into a fresh ticket draw instead of
  // AWAIT_ACTION. Skipped (a normal turn) when the short ticket deck is exhausted — an impossible
  // draw can't be forced.
  if (allKeptTicketsCompleted(board, next, nextPlayer)) {
    const forced = offerTickets(next, nextPlayer);
    if (forced) {
      events.push(...forced.events);
      return { state: forced.state, events };
    }
  }
  return { state: next, events };
}
