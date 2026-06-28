import { describe, it, expect } from 'vitest';
import { ENGINE_VERSION } from '../src/types/state';
import { borrowConnectedTicketIds } from '../src/graph/connectivity';
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
  it('is engine version 2 (bumped for the ruleParams + completedTickets state additions)', () => {
    expect(ENGINE_VERSION).toBe(2);
  });

  it('replays byte-identically under each variant', () => {
    const variants: { ruleParams: NonNullable<Parameters<typeof playGreedyGame>[2]>['ruleParams'] }[] = [
      { ruleParams: { unlimitedStationBorrow: true } },
      { ruleParams: { secondDrawAfterBlindRainbow: true } },
      { ruleParams: { noUnfinishedTicketPenalty: true } },
    ];
    for (const v of variants) {
      const r = playGreedyGame(3, 'variant-seed', { ruleParams: v.ruleParams });
      const replayed = replay(r.board, r.config, r.log);
      expect(stateDigest(replayed.state)).toBe(stateDigest(r.finalState));
    }
  });

  it('locked completion set equals a fresh end-game evaluation (monotonicity invariant)', () => {
    const r = playGreedyGame(4, 'borrow-monotone', { ruleParams: { unlimitedStationBorrow: true } });
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

  it('records no locked completion when the variant is off (default game)', () => {
    const r = playGreedyGame(3, 'no-variant', {});
    for (const pid of r.finalState.turnOrder) {
      expect(r.finalState.players[pid as string]!.completedTickets).toEqual([]);
    }
  });
});
