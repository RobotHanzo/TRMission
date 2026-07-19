// Shared driver for bot-vs-bot test games: plays a full 2-bot match on the Taiwan board and
// throws (with the seed in the message) on any illegal or non-deterministic pick, so both the
// CI specs and the opt-in strength harness fail loudly with the offending seed.
import { initGame, legalActions, reduce, taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { Board, GameConfig, GameState } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { chooseBotAction } from '../src';
import type { BotDifficulty } from '../src';

export const A = asPlayerId('bot:a');
export const B = asPlayerId('bot:b');

export interface DriveOpts {
  readonly ruleParams?: GameConfig['ruleParams'];
  /** Re-pick every action and require the identical choice (pure function of state + botId). */
  readonly checkDeterminism?: boolean;
}

/** Drive a full 2-bot game to GAME_OVER, each seat with its own difficulty. */
export function driveGame(
  seed: string,
  difficultyA: BotDifficulty,
  difficultyB: BotDifficulty,
  opts: DriveOpts = {},
): GameState {
  const board: Board = taiwanBoard();
  const config: GameConfig = {
    seed,
    players: [
      { id: A, seat: 0 },
      { id: B, seat: 1 },
    ],
    contentHash: CONTENT_HASH,
    ...(opts.ruleParams ? { ruleParams: opts.ruleParams } : {}),
  };
  let state = initGame(board, config);
  for (let steps = 0; steps < 3000; steps++) {
    if (state.turn.phase === 'GAME_OVER') return state;
    // Whoever holds a decision right now (setup offers can be concurrent).
    const actor = [A, B].find((p) => legalActions(board, state, p).length > 0);
    if (!actor) throw new Error(`no actor has a legal move (seed ${seed})`);
    const difficulty = actor === A ? difficultyA : difficultyB;
    const action = chooseBotAction(board, state, actor, difficulty);
    if (!action) throw new Error(`bot returned null with legal moves (seed ${seed})`);
    if (opts.checkDeterminism) {
      const again = chooseBotAction(board, state, actor, difficulty);
      if (JSON.stringify(again) !== JSON.stringify(action))
        throw new Error(`non-deterministic pick (seed ${seed}): ${JSON.stringify(action)}`);
    }
    const r = reduce(board, state, action);
    if (!r.ok) throw new Error(`illegal bot action (seed ${seed}): ${JSON.stringify(action)}`);
    state = r.value.state;
  }
  throw new Error(`2-bot game did not finish within 3000 actions (seed ${seed})`);
}

/** Final total for one player; throws if the game has no scoreboard or the player is missing. */
export function totalScore(state: GameState, id: string): number {
  const line = state.finalScores?.players.find((p) => (p.playerId as string) === id);
  if (!line) throw new Error(`no final score line for ${id}`);
  return line.total;
}
