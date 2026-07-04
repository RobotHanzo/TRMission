import { describe, it, expect, vi } from 'vitest';
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
import { useReplayPlayer, STEP_MS } from './useReplayPlayer';

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

/**
 * Greedy-drive the engine until a tunnel claim is legal, take it, then resolve it — returns the
 * log ending right after the RESOLVE_TUNNEL action, so `actions.length - 1` is that resolve step
 * and `actions.length - 2` is the CLAIM_ROUTE that opened the TUNNEL_PENDING reveal.
 */
function scriptActionsThroughTunnel(maxActions: number): Action[] {
  const board = taiwanBoard();
  let state = initGame(board, config);
  const out: Action[] = [];
  while (out.length < maxActions && state.turn.phase !== 'GAME_OVER') {
    const phase = state.turn.phase;
    let action: Action;
    if (phase === 'SETUP_TICKETS') {
      const actor = players
        .map((p) => p.id)
        .find((p) => (state.players[p as string]?.pendingTicketOffer?.length ?? 0) > 0)!;
      action = legalActions(board, state, actor)[0]!;
    } else {
      const actor = state.turnOrder[state.turn.orderIndex]!;
      const acts = legalActions(board, state, actor);
      if (phase === 'TUNNEL_PENDING') {
        action = acts.find((a) => a.t === 'RESOLVE_TUNNEL')!;
      } else if (phase === 'AWAIT_ACTION') {
        const tunnelClaim = acts.find(
          (a) => a.t === 'CLAIM_ROUTE' && board.routeById.get(a.routeId as string)?.isTunnel,
        );
        action = tunnelClaim ?? acts[0]!;
      } else {
        action = acts[0]!;
      }
    }
    const r = reduce(board, state, action);
    if (!r.ok) throw new Error(`scripted action rejected (${phase}): ${r.error.code}`);
    const wasResolvingTunnel = phase === 'TUNNEL_PENDING';
    state = r.value.state;
    out.push(action);
    if (wasResolvingTunnel) return out;
  }
  throw new Error('scripted game never reached a tunnel claim');
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

  it('autoplay holds on a tunnel reveal instead of closing the dialog after one plain STEP_MS tick', () => {
    const actions = scriptActionsThroughTunnel(500);
    const resolveStep = actions.length - 1;
    const revealStep = actions.length - 2;
    const { hook } = setup(actions, null);

    vi.useFakeTimers();
    try {
      act(() => hook.result.current.seek(revealStep));
      act(() => hook.result.current.play());
      // First tick applies the CLAIM_ROUTE that opens the tunnel reveal.
      act(() => void vi.advanceTimersByTime(STEP_MS));
      expect(hook.result.current.step).toBe(revealStep + 1);
      // A single plain STEP_MS beat is not enough time to also show the reveal + result —
      // autoplay must NOT have applied RESOLVE_TUNNEL (which would close the dialog) yet.
      act(() => void vi.advanceTimersByTime(STEP_MS));
      expect(hook.result.current.step).toBe(revealStep + 1);
      // Comfortably past the full reveal + dwell, the resolve step lands.
      act(() => void vi.advanceTimersByTime(3000));
      expect(hook.result.current.step).toBe(resolveStep + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});
