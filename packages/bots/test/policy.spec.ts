import { describe, it, expect } from 'vitest';
import { initGame, legalActions, reduce, taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { Board, GameConfig, GameState } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { chooseBotAction, isBotId, BOT_ID_PREFIX, BOT_DIFFICULTIES } from '../src';

const A = asPlayerId('bot:a');
const B = asPlayerId('bot:b');

function driveToCompletion(seed: string): GameState {
  const board: Board = taiwanBoard();
  const config: GameConfig = {
    seed,
    players: [
      { id: A, seat: 0 },
      { id: B, seat: 1 },
    ],
    contentHash: CONTENT_HASH,
  };
  let state = initGame(board, config);
  for (let steps = 0; steps < 2000; steps++) {
    if (state.turn.phase === 'GAME_OVER') return state;
    // Whoever holds a decision right now (setup offers can be concurrent).
    const actor = [A, B].find((p) => legalActions(board, state, p).length > 0);
    expect(actor).toBeDefined();
    const action = chooseBotAction(board, state, actor!, 'MEDIUM');
    expect(action).not.toBeNull();
    // Deterministic function of state + botId: a second call picks the identical move.
    expect(chooseBotAction(board, state, actor!, 'MEDIUM')).toEqual(action);
    const r = reduce(board, state, action!);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    state = r.value.state;
  }
  throw new Error('2-bot game did not finish within 2000 actions');
}

describe('@trm/bots', () => {
  it('drives a full 2-bot game to completion with only legal, deterministic picks', () => {
    const state = driveToCompletion('bots-package-spec');
    expect(state.finalScores).not.toBeNull();
  });

  it('exposes the id helpers and the difficulty roster', () => {
    expect(isBotId(`${BOT_ID_PREFIX}x`)).toBe(true);
    expect(isBotId('user-1')).toBe(false);
    expect(BOT_DIFFICULTIES).toEqual(['EASY', 'MEDIUM', 'HARD']);
  });
});
