import { describe, it, expect } from 'vitest';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import { taiwanBoard, CONTENT_HASH } from '../src/taiwan';
import type { GameConfig } from '../src/config';
import type { GameState } from '../src/types/state';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { cloneState } from '../src/serialize';

function configFor(ruleParams?: GameConfig['ruleParams']): {
  board: ReturnType<typeof taiwanBoard>;
  config: GameConfig;
} {
  const board = taiwanBoard();
  const players = [0, 1].map((i) => ({ id: asPlayerId(`p${i}`), seat: i as SeatIndex }));
  return {
    board,
    config: {
      seed: 'rainbow',
      players,
      contentHash: CONTENT_HASH,
      ...(ruleParams ? { ruleParams } : {}),
    },
  };
}

/** Drive past SETUP_TICKETS so it is p0's turn in AWAIT_ACTION. */
function toAwait(ruleParams?: GameConfig['ruleParams']): {
  board: ReturnType<typeof taiwanBoard>;
  state: GameState;
} {
  const { board, config } = configFor(ruleParams);
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

/** Force the top of the draw deck (last element) to a LOCOMOTIVE. */
function withLocoTop(s: GameState): GameState {
  const c = cloneState(s);
  return { ...c, deck: [...c.deck.slice(0, -1), 'LOCOMOTIVE'] };
}

describe('secondDrawAfterBlindRainbow', () => {
  it('OFF (default): a blind rainbow on the first draw ends the turn', () => {
    const { board, state } = toAwait();
    const s = withLocoTop(state);
    const r = reduce(board, s, { t: 'DRAW_BLIND', player: asPlayerId('p0') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.turn.phase).toBe('AWAIT_ACTION');
    expect(r.value.state.turn.orderIndex).toBe(1); // advanced to the next player
  });

  it('ON: a blind rainbow on the first draw still allows a second draw', () => {
    const { board, state } = toAwait({ secondDrawAfterBlindRainbow: true });
    const s = withLocoTop(state);
    const r = reduce(board, s, { t: 'DRAW_BLIND', player: asPlayerId('p0') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.turn.phase).toBe('DRAWING_CARDS');
    expect(r.value.state.turn.cardsDrawnThisTurn).toBe(1);
  });

  it('OFF: a non-rainbow first blind draw still allows a second draw', () => {
    const { board, state } = toAwait();
    const s = { ...cloneState(state), deck: [...state.deck.slice(0, -1), 'RED' as const] };
    const r = reduce(board, s, { t: 'DRAW_BLIND', player: asPlayerId('p0') });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.turn.phase).toBe('DRAWING_CARDS');
  });
});
