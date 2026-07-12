import { describe, it, expect } from 'vitest';
import { asPlayerId, emptyHand, type SeatIndex } from '@trm/shared';
import { taiwanBoard, CONTENT_HASH } from '../src/taiwan';
import type { GameConfig } from '../src/config';
import type { GameState } from '../src/types/state';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { legalActions } from '../src/selectors';
import { hasAnyLegalMove } from '../src/legality';
import { cloneState } from '../src/serialize';
import { currentPlayerId } from '../src/turn';

/** Drive past SETUP_TICKETS so it is p0's turn in AWAIT_ACTION, then force a dead-pool state. */
function deadPool(handP0: Partial<Record<string, number>> = {}): {
  board: ReturnType<typeof taiwanBoard>;
  state: GameState;
} {
  const board = taiwanBoard();
  const players = [0, 1].map((i) => ({ id: asPlayerId(`p${i}`), seat: i as SeatIndex }));
  const config: GameConfig = { seed: 'deadlock', players, contentHash: CONTENT_HASH };
  let state = initGame(board, config);
  while (state.turn.phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer);
    const offer = state.players[pid as string]?.pendingTicketOffer ?? [];
    const r = reduce(board, state, { t: 'KEEP_INITIAL_TICKETS', player: pid!, keep: [...offer] });
    if (!r.ok) throw new Error(`setup failed: ${r.error.code}`);
    state = r.value.state;
  }
  const s = cloneState(state);
  // Dead pool: no deck, no discard, empty market. Empty hands ⇒ no claim/build. Trains high so the
  // trains≤2 endgame path never fires. Short ticket deck kept non-empty on purpose.
  return {
    board,
    state: {
      ...s,
      deck: [],
      discard: emptyHand(),
      market: s.market.map(() => null),
      players: {
        p0: { ...s.players.p0!, hand: { ...emptyHand(), ...handP0 }, trainCars: 40 },
        p1: { ...s.players.p1!, hand: emptyHand(), trainCars: 40 },
      },
    },
  };
}

describe('dead-pool deadlock: a stuck player must PASS', () => {
  it('a stuck player has PASS as their sole legal action, and DRAW_TICKETS is rejected', () => {
    const { board, state } = deadPool();
    expect(state.ticketDeckShort.length).toBeGreaterThan(0); // the escape hatch we are closing
    const p0 = asPlayerId('p0');
    expect(hasAnyLegalMove(board, state, p0)).toBe(false);
    const acts = legalActions(board, state, p0);
    expect(acts.map((a) => a.t)).toEqual(['PASS']);
    const draw = reduce(board, state, { t: 'DRAW_TICKETS', player: p0 });
    expect(draw.ok).toBe(false);
  });
});

describe('dead-pool deadlock: the end sequence begins and the game ends', () => {
  it('a stuck table triggers ENDGAME_TRIGGERED reason=DEADLOCK and ends after a round of passes', () => {
    const { board, state } = deadPool();
    const p0 = asPlayerId('p0');
    const p1 = asPlayerId('p1');
    const r0 = reduce(board, state, { t: 'PASS', player: p0 });
    expect(r0.ok).toBe(true);
    if (!r0.ok) return;
    const trig = r0.value.events.find((e) => e.e === 'ENDGAME_TRIGGERED');
    expect(trig).toBeDefined();
    expect(trig && 'reason' in trig ? trig.reason : null).toBe('DEADLOCK');
    expect(r0.value.state.endgame.triggered).toBe(true);
    expect(currentPlayerId(r0.value.state)).toBe(p1);
    const r1 = reduce(board, r0.value.state, { t: 'PASS', player: p1 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.state.turn.phase).toBe('GAME_OVER');
    expect(r1.value.state.finalScores).not.toBeNull();
  });

  it('a player who can still build a station gets a real final turn (not skipped)', () => {
    // p0 can afford a first station (cost 1 card) but has 0 trains, so NO route is claimable by
    // anyone (routes require trains; stations do not). p1 is empty-handed. Advance to p1 so the
    // trigger fires on p1's pass and lands back on p0.
    const { board, state: base } = deadPool({ RED: 1 });
    const p1 = asPlayerId('p1');
    const p0 = asPlayerId('p0');
    const state: GameState = {
      ...base,
      turn: { ...base.turn, orderIndex: 1 },
      players: { ...base.players, p0: { ...base.players.p0!, trainCars: 0 } },
    };
    const r = reduce(board, state, { t: 'PASS', player: p1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.endgame.triggered).toBe(true);
    expect(currentPlayerId(r.value.state)).toBe(p0);
    const acts = legalActions(board, r.value.state, p0).map((a) => a.t);
    expect(acts).toContain('BUILD_STATION');
    expect(acts).not.toContain('PASS'); // p0 has a productive move, so PASS is illegal
  });
});
