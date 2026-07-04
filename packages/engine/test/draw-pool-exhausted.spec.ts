import { describe, it, expect } from 'vitest';
import { asPlayerId, emptyHand, type SeatIndex } from '@trm/shared';
import { taiwanBoard, CONTENT_HASH } from '../src/taiwan';
import type { GameConfig } from '../src/config';
import type { GameState } from '../src/types/state';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { cloneState } from '../src/serialize';

function configFor(): { board: ReturnType<typeof taiwanBoard>; config: GameConfig } {
  const board = taiwanBoard();
  const players = [0, 1].map((i) => ({ id: asPlayerId(`p${i}`), seat: i as SeatIndex }));
  return { board, config: { seed: 'exhausted', players, contentHash: CONTENT_HASH } };
}

/** Drive past SETUP_TICKETS so it is p0's turn in AWAIT_ACTION. */
function toAwait(): { board: ReturnType<typeof taiwanBoard>; state: GameState } {
  const { board, config } = configFor();
  let state = initGame(board, config);
  while (state.turn.phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer);
    const offer = state.players[pid as string]?.pendingTicketOffer ?? [];
    const r = reduce(board, state, { t: 'KEEP_INITIAL_TICKETS', player: pid!, keep: [...offer] });
    if (!r.ok) throw new Error(`setup failed: ${r.error.code}`);
    state = r.value.state;
  }
  return { board, state };
}

describe('second draw provably impossible (deck+discard+market all exhausted/unusable)', () => {
  it('DRAW_BLIND: taking the last card with no possible second draw ends the turn immediately', () => {
    const { board, state } = toAwait();
    const s: GameState = {
      ...cloneState(state),
      deck: ['RED'],
      discard: emptyHand(),
      market: state.market.map(() => null),
    };
    const before = s.players['p0']?.hand.RED ?? 0;
    const r = reduce(board, s, { t: 'DRAW_BLIND', player: asPlayerId('p0') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Turn ended right away — never entered DRAWING_CARDS, no dead-end second-draw prompt.
    expect(r.value.state.turn.phase).toBe('AWAIT_ACTION');
    expect(r.value.state.turn.orderIndex).toBe(1);
    expect(r.value.state.players['p0']?.hand.RED).toBe(before + 1);
  });

  it('DRAW_FACEUP: taking the last market card with no possible second draw ends the turn immediately', () => {
    const { board, state } = toAwait();
    const market: ('RED' | null)[] = state.market.map(() => null);
    market[0] = 'RED';
    const s: GameState = {
      ...cloneState(state),
      deck: [],
      discard: emptyHand(),
      market,
    };
    const before = s.players['p0']?.hand.RED ?? 0;
    const r = reduce(board, s, { t: 'DRAW_FACEUP', player: asPlayerId('p0'), slot: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.turn.phase).toBe('AWAIT_ACTION');
    expect(r.value.state.turn.orderIndex).toBe(1);
    expect(r.value.state.players['p0']?.hand.RED).toBe(before + 1);
  });

  it('DRAW_BLIND: still allows a second draw when a non-locomotive market card remains', () => {
    const { board, state } = toAwait();
    const market = state.market.map(() => null as ('RED' | null));
    market[0] = 'RED'; // a legal second-draw target
    const s: GameState = {
      ...cloneState(state),
      deck: ['BLUE'],
      discard: emptyHand(),
      market,
    };
    const r = reduce(board, s, { t: 'DRAW_BLIND', player: asPlayerId('p0') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.turn.phase).toBe('DRAWING_CARDS');
    expect(r.value.state.turn.cardsDrawnThisTurn).toBe(1);
  });

  it('DRAW_BLIND: still allows a second draw when the deck has more cards', () => {
    const { board, state } = toAwait();
    const s: GameState = {
      ...cloneState(state),
      deck: ['BLUE', 'RED'],
      discard: emptyHand(),
      market: state.market.map(() => null),
    };
    const r = reduce(board, s, { t: 'DRAW_BLIND', player: asPlayerId('p0') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.turn.phase).toBe('DRAWING_CARDS');
  });

  it('DRAW_BLIND: a market of only face-up Locomotives with empty deck+discard still ends the turn', () => {
    const { board, state } = toAwait();
    const market = state.market.map(() => 'LOCOMOTIVE' as const);
    const s: GameState = {
      ...cloneState(state),
      deck: ['RED'],
      discard: emptyHand(),
      market,
    };
    const r = reduce(board, s, { t: 'DRAW_BLIND', player: asPlayerId('p0') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A face-up Locomotive can never be taken as a second draw, so this market offers nothing.
    expect(r.value.state.turn.phase).toBe('AWAIT_ACTION');
  });
});
