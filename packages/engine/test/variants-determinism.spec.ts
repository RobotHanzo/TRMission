import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION } from '../src/types/state';
import { borrowConnectedTicketIds, ownConnectedTicketIds } from '../src/graph/connectivity';
import { stationBorrowEdges, evaluatePlayerTickets } from '../src/scoring';
import { stateDigest, replay } from '../src/serialize';
import { playGreedyGame } from './helpers';
import type { GameState } from '../src/types/state';
import type { Board } from '../src/board';

function ownEdgesOf(board: Board, state: GameState, pid: string) {
  const out: { a: string; b: string }[] = [];
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell && cell.owner === pid) {
      const r = board.routeById.get(routeId);
      if (r) out.push({ a: r.a as string, b: r.b as string });
    }
  }
  return out;
}

describe('rule-variant determinism & version', () => {
  it('is engine version 9 (deadlock end-sequence)', () => {
    expect(ENGINE_VERSION).toBe(9);
  });

  it('replays byte-identically under each variant', () => {
    const variants: {
      ruleParams: NonNullable<Parameters<typeof playGreedyGame>[2]>['ruleParams'];
    }[] = [
      { ruleParams: { unlimitedStationBorrow: true } },
      { ruleParams: { secondDrawAfterBlindRainbow: true } },
      { ruleParams: { noUnfinishedTicketPenalty: true } },
      { ruleParams: { doubleRouteSingleFor23: false } },
      { ruleParams: { eventsMode: 'intense' } },
    ];
    for (const v of variants) {
      const r = playGreedyGame(3, 'variant-seed', { ruleParams: v.ruleParams });
      const replayed = replay(r.board, r.config, r.log);
      expect(stateDigest(replayed.state)).toBe(stateDigest(r.finalState));
    }
  });

  it('locked completion set equals a fresh end-game evaluation (monotonicity invariant)', () => {
    // Exercise the invariant on a game that actually completes a ticket. Any single seed's outcome
    // shifts with content/engine tweaks (this test used to pin one brittle seed), so scan a handful
    // and take the first game that reaches GAME_OVER with a completion.
    const completingGame = () => {
      for (let i = 0; i < 40; i++) {
        const g = playGreedyGame(4, `borrow-monotone-${i}`, {
          ruleParams: { unlimitedStationBorrow: true },
        });
        const completed =
          g.finalState.turn.phase === 'GAME_OVER' &&
          g.finalState.turnOrder.some(
            (pid) =>
              (g.finalState.players[pid as string]!.completedTickets as readonly string[]).length >
              0,
          );
        if (completed) return g;
      }
      throw new Error('no borrow-monotone seed produced a ticket completion');
    };
    const r = completingGame();
    expect(r.finalState.turn.phase).toBe('GAME_OVER');
    let sawCompletion = false;
    for (const pid of r.finalState.turnOrder) {
      const p = r.finalState.players[pid as string]!;
      const keptGoals = p.keptTickets
        .map((id) => {
          const t = r.board.ticketById.get(id as string);
          return t ? { id: id as string, a: t.a as string, b: t.b as string } : null;
        })
        .filter((x): x is { id: string; a: string; b: string } => x !== null);
      const fresh = new Set(
        borrowConnectedTicketIds({
          ownEdges: ownEdgesOf(r.board, r.finalState, pid as string),
          borrowEdges: stationBorrowEdges(r.board, r.finalState, pid),
          tickets: keptGoals,
        }),
      );
      const locked = new Set(p.completedTickets as readonly string[]);
      expect(locked).toEqual(fresh);
      if (locked.size > 0) sawCompletion = true;

      // The end-game scoreboard's completed count agrees with the locked set.
      const detail = evaluatePlayerTickets(r.board, r.finalState, pid);
      expect(detail.completed).toBe(locked.size);
    }
    expect(sawCompletion).toBe(true); // sanity: at least one ticket was actually completed
  });

  it('locked completion (variant off) always equals a fresh own-track recomputation', () => {
    const r = playGreedyGame(3, 'no-variant', {});
    expect(r.finalState.turn.phase).toBe('GAME_OVER');
    for (const pid of r.finalState.turnOrder) {
      const p = r.finalState.players[pid as string]!;
      const keptGoals = p.keptTickets
        .map((id) => {
          const t = r.board.ticketById.get(id as string);
          return t ? { id: id as string, a: t.a as string, b: t.b as string } : null;
        })
        .filter((x): x is { id: string; a: string; b: string } => x !== null);
      const fresh = new Set(
        ownConnectedTicketIds({
          ownEdges: ownEdgesOf(r.board, r.finalState, pid as string),
          tickets: keptGoals,
        }),
      );
      const locked = new Set(p.completedTickets as readonly string[]);
      expect(locked).toEqual(fresh);
    }
  });
});
