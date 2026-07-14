import { describe, it, expect } from 'vitest';
import { initGame, legalActions, reduce, taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { Board, GameConfig, GameState } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { chooseBotAction, isBotId, BOT_ID_PREFIX, BOT_DIFFICULTIES } from '../src';
import type { BotDifficulty } from '../src';

const A = asPlayerId('bot:a');
const B = asPlayerId('bot:b');

/** Drive a full 2-bot game, each seat with its own difficulty; every pick must be legal + deterministic. */
function driveToCompletion(
  seed: string,
  difficultyA: BotDifficulty,
  difficultyB: BotDifficulty,
  ruleParams?: GameConfig['ruleParams'],
): GameState {
  const board: Board = taiwanBoard();
  const config: GameConfig = {
    seed,
    players: [
      { id: A, seat: 0 },
      { id: B, seat: 1 },
    ],
    contentHash: CONTENT_HASH,
    ...(ruleParams ? { ruleParams } : {}),
  };
  let state = initGame(board, config);
  for (let steps = 0; steps < 3000; steps++) {
    if (state.turn.phase === 'GAME_OVER') return state;
    // Whoever holds a decision right now (setup offers can be concurrent).
    const actor = [A, B].find((p) => legalActions(board, state, p).length > 0);
    expect(actor).toBeDefined();
    const difficulty = actor === A ? difficultyA : difficultyB;
    const action = chooseBotAction(board, state, actor!, difficulty);
    expect(action).not.toBeNull();
    // Deterministic function of state + botId: a second call picks the identical move.
    expect(chooseBotAction(board, state, actor!, difficulty)).toEqual(action);
    const r = reduce(board, state, action!);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    state = r.value.state;
  }
  throw new Error('2-bot game did not finish within 3000 actions');
}

const totalScore = (state: GameState, id: string): number => {
  const line = state.finalScores?.players.find((p) => (p.playerId as string) === id);
  expect(line).toBeDefined();
  return line!.total;
};

describe('@trm/bots', () => {
  it('drives a full 2-bot game to completion with only legal, deterministic picks', () => {
    const state = driveToCompletion('bots-package-spec', 'MEDIUM', 'MEDIUM');
    expect(state.finalScores).not.toBeNull();
  });

  it('drives a full HELL-vs-HELL game to completion with only legal, deterministic picks', () => {
    const state = driveToCompletion('bots-hell-spec', 'HELL', 'HELL');
    expect(state.finalScores).not.toBeNull();
  });

  it('drives a HELL game with intense random events to completion (event actions stay legal)', () => {
    const state = driveToCompletion('bots-hell-events-spec', 'HELL', 'HELL', {
      eventsMode: 'intense',
    });
    expect(state.finalScores).not.toBeNull();
  });

  it('HELL outscores HARD across seeded matches', () => {
    // Deterministic (fixed seeds), so this is a regression gate, not a flake: a policy change
    // that costs HELL its edge over the previous top difficulty should fail loudly here.
    const seeds = ['hell-vs-hard-1', 'hell-vs-hard-2', 'hell-vs-hard-3', 'hell-vs-hard-4'];
    let wins = 0;
    let margin = 0;
    for (const [i, seed] of seeds.entries()) {
      // Alternate seats so a first-player advantage can't carry the comparison.
      const hellFirst = i % 2 === 0;
      const state = driveToCompletion(seed, hellFirst ? 'HELL' : 'HARD', hellFirst ? 'HARD' : 'HELL');
      const hell = totalScore(state, (hellFirst ? A : B) as string);
      const hard = totalScore(state, (hellFirst ? B : A) as string);
      if (hell > hard) wins++;
      margin += hell - hard;
    }
    expect(wins).toBeGreaterThanOrEqual(3);
    expect(margin).toBeGreaterThan(0);
  });

  it('exposes the id helpers and the difficulty roster', () => {
    expect(isBotId(`${BOT_ID_PREFIX}x`)).toBe(true);
    expect(isBotId('user-1')).toBe(false);
    expect(BOT_DIFFICULTIES).toEqual(['EASY', 'MEDIUM', 'HARD', 'HELL']);
  });
});
