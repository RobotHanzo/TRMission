import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  taiwanBoard,
  initGame,
  reduce,
  replay,
  redactFor,
  legalActions,
  CONTENT_HASH,
} from '@trm/engine';
import type { Action, GameConfig, PlayerSeed } from '@trm/engine';
import { viewToSnapshot } from '@trm/codec';
import { asPlayerId, type PlayerId } from '@trm/shared';
import { createGameStore } from '../../store/game';
import { createLogStore } from '../../store/log';
import { useReplayPlayer } from './useReplayPlayer';

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];
const config: GameConfig = { seed: 'replay-test-1', players, contentHash: CONTENT_HASH };

/** Script `count` legal actions with a first-legal-action driver (pure engine, no server). */
function scriptActions(count: number): Action[] {
  const board = taiwanBoard();
  let state = initGame(board, config);
  const out: Action[] = [];
  while (out.length < count && state.turn.phase !== 'GAME_OVER') {
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? players
            .map((p) => p.id)
            .find((p) => (state.players[p as string]?.pendingTicketOffer?.length ?? 0) > 0)!
        : state.turnOrder[state.turn.orderIndex]!;
    const action = legalActions(board, state, actor)[0]!;
    const r = reduce(board, state, action);
    if (!r.ok) throw new Error(`scripted action rejected: ${r.error.code}`);
    state = r.value.state;
    out.push(action);
  }
  return out;
}

function setup(actions: Action[], viewer: PlayerId | null) {
  const game = createGameStore();
  const log = createLogStore();
  const board = taiwanBoard();
  const hook = renderHook(() => useReplayPlayer(board, config, actions, viewer, { game, log }));
  return { game, log, board, hook };
}

describe('useReplayPlayer', () => {
  it('projects genesis on mount (step 0)', () => {
    const { game, hook } = setup(scriptActions(4), asPlayerId('p1'));
    expect(hook.result.current.step).toBe(0);
    expect(hook.result.current.total).toBe(4);
    expect(game.getState().snapshot?.stateVersion).toBe(0);
    expect(game.getState().snapshot?.you?.playerId).toBe('p1');
  });

  it('next() advances one action and feeds animations + the log', () => {
    const actions = scriptActions(10);
    const { game, log, hook } = setup(actions, asPlayerId('p1'));
    act(() => hook.result.current.next());
    expect(hook.result.current.step).toBe(1);
    expect(game.getState().snapshot?.stateVersion).toBe(1);
    expect(game.getState().lastBatch).not.toBeNull();
    expect(log.getState().entries.length).toBeGreaterThan(0);
  });

  it('seek() lands on exactly the snapshot a pure replay produces; seek(0) resets to genesis', () => {
    const actions = scriptActions(40);
    const { game, board, hook } = setup(actions, asPlayerId('p1'));
    act(() => hook.result.current.seek(37));
    expect(hook.result.current.step).toBe(37);
    const rep = replay(board, config, actions.slice(0, 37));
    const expected = viewToSnapshot(
      redactFor(board, rep.state, asPlayerId('p1')),
      37,
      asPlayerId('p1'),
    );
    expect(game.getState().snapshot).toEqual(expected);
    // Backward seek must work despite applySnapshot's stale-version guard (store reset first).
    act(() => hook.result.current.seek(0));
    expect(game.getState().snapshot?.stateVersion).toBe(0);
  });

  it('setViewer re-projects the same step from another perspective', () => {
    const { game, hook } = setup(scriptActions(6), asPlayerId('p1'));
    act(() => hook.result.current.setViewer(asPlayerId('p2')));
    expect(game.getState().snapshot?.you?.playerId).toBe('p2');
    act(() => hook.result.current.setViewer(null));
    expect(game.getState().snapshot?.you).toBeUndefined();
  });

  it('prev() steps back without animations', () => {
    const { game, hook } = setup(scriptActions(6), null);
    act(() => hook.result.current.next());
    act(() => hook.result.current.next());
    const batchesBefore = game.getState().lastBatch?.seq ?? 0;
    act(() => hook.result.current.prev());
    expect(hook.result.current.step).toBe(1);
    // A rebuild resets the store — no new animation batch was pushed.
    expect(game.getState().lastBatch).toBeNull();
    expect(batchesBefore).toBeGreaterThan(0);
  });

  it('animate is true after next(), false again after any silent rebuild', () => {
    const actions = scriptActions(10);
    const { hook } = setup(actions, asPlayerId('p1'));
    expect(hook.result.current.animate).toBe(false); // genesis: silent
    act(() => hook.result.current.next());
    expect(hook.result.current.animate).toBe(true); // forward step: animated
    act(() => hook.result.current.seek(0));
    expect(hook.result.current.animate).toBe(false); // seek: silent
    act(() => hook.result.current.next());
    expect(hook.result.current.animate).toBe(true);
    act(() => hook.result.current.prev());
    expect(hook.result.current.animate).toBe(false); // prev: silent
    act(() => hook.result.current.next());
    expect(hook.result.current.animate).toBe(true);
    act(() => hook.result.current.setViewer(asPlayerId('p2')));
    expect(hook.result.current.animate).toBe(false); // perspective switch: silent
  });
});
