import { describe, it, expect } from 'vitest';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import { taiwanBoard, CONTENT_HASH } from '../src/taiwan';
import type { Board } from '../src/board';
import type { GameConfig } from '../src/config';
import type { GameState, PlayerState } from '../src/types/state';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { cloneState } from '../src/serialize';
import { emptyHand } from '../src/hand';

function cfg(ruleParams?: GameConfig['ruleParams']): { board: Board; config: GameConfig } {
  const board = taiwanBoard();
  const players = [0, 1].map((i) => ({ id: asPlayerId(`p${i}`), seat: i as SeatIndex }));
  return {
    board,
    config: {
      seed: 'lock',
      players,
      contentHash: CONTENT_HASH,
      ...(ruleParams ? { ruleParams } : {}),
    },
  };
}

const allLoco = (length: number) => ({ color: null, colorCount: 0, locomotives: length });
const locoHand = (): PlayerState['hand'] => ({ ...emptyHand(), LOCOMOTIVE: 40 });

/** A ticket whose endpoints are joined by a single non-tunnel, non-ferry, non-double route. */
function findDirect(board: Board) {
  for (const t of board.content.tickets) {
    const r = board.content.routes.find(
      (rt) =>
        !rt.isTunnel &&
        rt.ferryLocos === 0 &&
        rt.doubleGroup === undefined &&
        ((rt.a === t.a && rt.b === t.b) || (rt.a === t.b && rt.b === t.a)),
    );
    if (r) return { t, r };
  }
  return null;
}

/** A ticket T with a 2-edge path T.a–m–T.b over two simple routes. */
function findBorrow(board: Board) {
  const simple = board.content.routes.filter(
    (r) => !r.isTunnel && r.ferryLocos === 0 && r.doubleGroup === undefined,
  );
  for (const t of board.content.tickets) {
    for (const r1 of simple) {
      const m = r1.a === t.a ? r1.b : r1.b === t.a ? r1.a : null;
      if (!m || m === t.b) continue;
      const r2 = simple.find(
        (r) => r.id !== r1.id && ((r.a === m && r.b === t.b) || (r.a === t.b && r.b === m)),
      );
      if (r2) return { t, r1, r2, m };
    }
  }
  return null;
}

function readyState(
  s0: GameState,
  overrides: Partial<Record<string, Partial<PlayerState>>>,
  ownership = {},
): GameState {
  const players: Record<string, PlayerState> = {};
  for (const [id, p] of Object.entries(s0.players)) {
    players[id] = { ...p, pendingTicketOffer: null, ...(overrides[id] ?? {}) };
  }
  return {
    ...cloneState(s0),
    players,
    ownership,
    turn: { orderIndex: 0, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 },
  };
}

describe('instant locked ticket completion (unlimitedStationBorrow on)', () => {
  it('locks a ticket the moment own track connects it', () => {
    const { board, config } = cfg({ unlimitedStationBorrow: true });
    const found = findDirect(board);
    expect(found).not.toBeNull();
    const { t, r } = found!;
    const me = asPlayerId('p0');
    const state = readyState(initGame(board, config), {
      p0: { hand: locoHand(), keptTickets: [t.id] },
    });

    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: me,
      routeId: r.id,
      payment: allLoco(r.length),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.players['p0']!.completedTickets).toContain(t.id);
    expect(
      res.value.events.some(
        (e) => e.e === 'TICKET_COMPLETED' && e.ticket === t.id && e.player === me,
      ),
    ).toBe(true);
  });

  it('locks a borrow-completed ticket when an OPPONENT claims the borrowed leg', () => {
    const { board, config } = cfg({ unlimitedStationBorrow: true });
    const found = findBorrow(board);
    expect(found).not.toBeNull();
    const { t, r1, r2, m } = found!;
    const me = asPlayerId('p0');
    const opp = asPlayerId('p1');

    // p0 owns r1 (T.a–m), has a station at m, kept T. p1 is to act and will claim r2 (m–T.b).
    const state: GameState = {
      ...readyState(
        initGame(board, config),
        {
          p0: { keptTickets: [t.id], stationsRemaining: 2 },
          p1: { hand: locoHand() },
        },
        { [r1.id as string]: { owner: me } },
      ),
      stations: [{ playerId: me, cityId: m }],
      turn: { orderIndex: 1, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 }, // p1's turn
    };

    // Before the opponent's claim, T is not yet complete (m–T.b is unowned).
    expect(state.players['p0']!.completedTickets).toEqual([]);

    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: opp,
      routeId: r2.id,
      payment: allLoco(r2.length),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.players['p0']!.completedTickets).toContain(t.id);
    expect(
      res.value.events.some(
        (e) => e.e === 'TICKET_COMPLETED' && e.ticket === t.id && e.player === me,
      ),
    ).toBe(true);
  });

  it('does not record completion in state when the variant is off', () => {
    const { board, config } = cfg(); // default: unlimitedStationBorrow false
    const { t, r } = findDirect(board)!;
    const me = asPlayerId('p0');
    const state = readyState(initGame(board, config), {
      p0: { hand: locoHand(), keptTickets: [t.id] },
    });
    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: me,
      routeId: r.id,
      payment: allLoco(r.length),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.players['p0']!.completedTickets).toEqual([]);
    expect(res.value.events.some((e) => e.e === 'TICKET_COMPLETED')).toBe(false);
  });
});
