import { describe, it, expect } from 'vitest';
import { initGame, taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { SeatIndex } from '@trm/shared';
import type { GameConfig, GameState } from '@trm/engine';
import { chooseBotAction, isBotId, BOT_ID_PREFIX, BOT_DIFFICULTIES } from '../src';
import type { BotDifficulty } from '../src';
import { A, B, C, D, driveGame, driveTeamGame, totalScore } from './helpers';

/** Drive a full 2-bot game with per-step determinism checks (see helpers.ts). */
function driveToCompletion(
  seed: string,
  difficultyA: BotDifficulty,
  difficultyB: BotDifficulty,
  ruleParams?: GameConfig['ruleParams'],
): GameState {
  return driveGame(seed, difficultyA, difficultyB, {
    checkDeterminism: true,
    ...(ruleParams ? { ruleParams } : {}),
  });
}

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
    // Deterministic (fixed seeds), so this never flakes for a GIVEN policy. It is a
    // NO-REGRESSION floor, not a strength proof: single seeds swing by ±70 points on seat
    // and draw luck, so ten sequential seeds (no cherry-picking) can only catch HELL falling
    // clearly behind the previous top policy. The discriminating strength measurement is the
    // 100-game sweep in strength.harness.spec.ts (TRM_BOT_HARNESS=1) — re-run it whenever
    // this gate or the policy weights change.
    const seeds = Array.from({ length: 10 }, (_, i) => `hell-vs-hard-${i + 1}`);
    let wins = 0;
    let margin = 0;
    for (const [i, seed] of seeds.entries()) {
      // Alternate seats so a first-player advantage can't carry the comparison.
      const hellFirst = i % 2 === 0;
      const state = driveToCompletion(
        seed,
        hellFirst ? 'HELL' : 'HARD',
        hellFirst ? 'HARD' : 'HELL',
      );
      const hell = totalScore(state, (hellFirst ? A : B) as string);
      const hard = totalScore(state, (hellFirst ? B : A) as string);
      if (hell > hard) wins++;
      margin += hell - hard;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
    expect(margin).toBeGreaterThan(0);
  });

  it('drives a full 4-bot / 2-team game to completion with only legal, deterministic picks', () => {
    const state = driveTeamGame('bots-team-spec', 'HELL');
    expect(state.finalScores?.teams).toHaveLength(2);
  });

  it('never routes a claim into a parallel track its own side already holds', () => {
    const board = taiwanBoard();
    const group = board.content.routes.find((r) => r.doubleGroup !== undefined)?.doubleGroup;
    const [t1, t2] = board.content.routes.filter((r) => r.doubleGroup === group);
    if (!t1 || !t2) throw new Error('expected a double-route pair on the Taiwan board');
    const seats = [A, B, C, D];
    let state = initGame(board, {
      seed: 'bots-team-parallel',
      players: seats.map((id, seat) => ({ id, seat: seat as SeatIndex })),
      teamCount: 2,
      contentHash: CONTENT_HASH,
    });
    // A's partner (C) holds one track; A is flush with wilds and on turn.
    state = {
      ...state,
      ownership: { [t1.id as string]: { owner: C } },
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, p]) => [
          id,
          {
            ...p,
            pendingTicketOffer: null,
            ...(id === (A as string) ? { hand: { ...p.hand, LOCOMOTIVE: 12 } } : {}),
          },
        ]),
      ),
      turn: {
        orderIndex: state.turnOrder.indexOf(A),
        phase: 'AWAIT_ACTION',
        cardsDrawnThisTurn: 0,
      },
    };
    for (const difficulty of BOT_DIFFICULTIES) {
      const action = chooseBotAction(board, state, A, difficulty);
      expect(action).not.toBeNull();
      expect(action?.t === 'CLAIM_ROUTE' && action.routeId === t2.id).toBe(false);
    }
  });

  it('exposes the id helpers and the difficulty roster', () => {
    expect(isBotId(`${BOT_ID_PREFIX}x`)).toBe(true);
    expect(isBotId('user-1')).toBe(false);
    expect(BOT_DIFFICULTIES).toEqual(['EASY', 'MEDIUM', 'HARD', 'HELL']);
  });
});
