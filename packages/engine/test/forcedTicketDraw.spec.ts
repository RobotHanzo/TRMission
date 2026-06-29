import { describe, it, expect } from 'vitest';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import { taiwanBoard, CONTENT_HASH } from '../src/taiwan';
import type { Board } from '../src/board';
import type { GameConfig } from '../src/config';
import type { GameState, PlayerState } from '../src/types/state';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { currentPlayerId } from '../src/turn';
import { cloneState } from '../src/serialize';
import { emptyHand } from '../src/hand';

// Rule 7.5: a player who has already connected EVERY kept ticket by their own track is forced, at
// the start of their turn, to draw new destination tickets — their turn opens straight into the
// ticket chooser (TICKET_SELECTION). Falls back to a normal turn when the short ticket deck is empty.

function cfg(ruleParams?: GameConfig['ruleParams']): { board: Board; config: GameConfig } {
  const board = taiwanBoard();
  const players = [0, 1].map((i) => ({ id: asPlayerId(`p${i}`), seat: i as SeatIndex }));
  return {
    board,
    config: {
      seed: 'forced',
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
  throw new Error('no direct ticket route on the map');
}

/** Any simple route p1 can claim to end their turn, distinct from `exclude`. */
function findOtherSimple(board: Board, exclude: string) {
  const r = board.content.routes.find(
    (rt) =>
      rt.id !== exclude && !rt.isTunnel && rt.ferryLocos === 0 && rt.doubleGroup === undefined,
  );
  if (!r) throw new Error('no second simple route');
  return r;
}

function readyState(
  s0: GameState,
  overrides: Partial<Record<string, Partial<PlayerState>>>,
  ownership: Record<string, { owner: ReturnType<typeof asPlayerId> }> = {},
): GameState {
  const players: Record<string, PlayerState> = {};
  for (const [id, p] of Object.entries(s0.players)) {
    players[id] = { ...p, pendingTicketOffer: null, ...(overrides[id] ?? {}) };
  }
  return {
    ...cloneState(s0),
    players,
    ownership,
    // p1 acts; ending their turn advances to p0 (the player under test).
    turn: { orderIndex: 1, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 },
  };
}

describe('forced ticket re-draw (rule 7.5)', () => {
  it('opens the ticket chooser at turn start when all kept tickets are own-connected', () => {
    const { board, config } = cfg();
    const { t, r } = findDirect(board);
    const r2 = findOtherSimple(board, r.id as string);
    const p0 = asPlayerId('p0');
    const p1 = asPlayerId('p1');

    const state = readyState(
      initGame(board, config),
      { p0: { keptTickets: [t.id] }, p1: { hand: locoHand(), keptTickets: [] } },
      { [r.id as string]: { owner: p0 } }, // p0 owns the route that connects ticket t
    );

    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: r2.id,
      payment: allLoco(r2.length),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ns = res.value.state;
    expect(ns.turn.phase).toBe('TICKET_SELECTION');
    expect(currentPlayerId(ns)).toBe(p0);
    expect(ns.players['p0']!.pendingTicketOffer).not.toBeNull();
    expect(ns.players['p0']!.pendingTicketOffer!.length).toBeGreaterThan(0);
    expect(res.value.events.some((e) => e.e === 'TICKETS_OFFERED' && e.player === p0)).toBe(true);
  });

  it('does NOT force a draw while an incomplete ticket remains', () => {
    const { board, config } = cfg();
    const { t, r } = findDirect(board);
    const r2 = findOtherSimple(board, r.id as string);
    const p0 = asPlayerId('p0');
    const p1 = asPlayerId('p1');

    // p0 keeps ticket t but owns NO routes — t is not own-connected.
    const state = readyState(
      initGame(board, config),
      { p0: { keptTickets: [t.id] }, p1: { hand: locoHand(), keptTickets: [] } },
      {},
    );

    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: r2.id,
      payment: allLoco(r2.length),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.turn.phase).toBe('AWAIT_ACTION');
    expect(currentPlayerId(res.value.state)).toBe(p0);
  });

  it('falls back to a normal turn when the short ticket deck is exhausted', () => {
    const { board, config } = cfg();
    const { t, r } = findDirect(board);
    const r2 = findOtherSimple(board, r.id as string);
    const p0 = asPlayerId('p0');
    const p1 = asPlayerId('p1');

    const state: GameState = {
      ...readyState(
        initGame(board, config),
        { p0: { keptTickets: [t.id] }, p1: { hand: locoHand(), keptTickets: [] } },
        { [r.id as string]: { owner: p0 } },
      ),
      ticketDeckShort: [], // nothing to draw — cannot force
    };

    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: r2.id,
      payment: allLoco(r2.length),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.turn.phase).toBe('AWAIT_ACTION');
  });

  it('does not force a draw for a player holding no tickets', () => {
    const { board, config } = cfg();
    const { r } = findDirect(board);
    const r2 = findOtherSimple(board, r.id as string);
    const p1 = asPlayerId('p1');

    const state = readyState(
      initGame(board, config),
      { p0: { keptTickets: [] }, p1: { hand: locoHand(), keptTickets: [] } },
      {},
    );

    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: r2.id,
      payment: allLoco(r2.length),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.turn.phase).toBe('AWAIT_ACTION');
  });
});
