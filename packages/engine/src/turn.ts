import type { PlayerId } from '@trm/shared';
import type { Board } from './board';
import type { GameState } from './types/state';
import type { GameEvent } from './types/events';
import { computeFinalScores } from './scoring';

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
  if (!endgame.triggered && (player?.trainCars ?? Infinity) <= state.ruleParams.endgameTrainThreshold) {
    endgame = { triggered: true, triggerPlayerIndex: curIdx, finalTurnsRemaining: n };
    triggeredNow = true;
    events.push({ e: 'ENDGAME_TRIGGERED', player: curPlayer, finalTurnsRemaining: n, visibility: 'PUBLIC' });
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
  const next: GameState = {
    ...state,
    consecutivePasses,
    endgame,
    turn: { orderIndex: nextIdx, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 },
  };
  events.push({
    e: 'TURN_STARTED',
    player: state.turnOrder[nextIdx] as PlayerId,
    orderIndex: nextIdx,
    visibility: 'PUBLIC',
  });
  return { state: next, events };
}
