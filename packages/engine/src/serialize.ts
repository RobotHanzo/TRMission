import { digest } from '@trm/shared';
import type { Board } from './board';
import type { GameConfig } from './config';
import type { GameState } from './types/state';
import type { Action } from './types/actions';
import type { GameEvent } from './types/events';
import { initGame } from './setup';
import { reduce } from './reduce';

/** Canonical state digest (key-sorted SHA-256) — the basis of golden-replay & recovery checks. */
export function stateDigest(state: GameState): string {
  return digest(state);
}

/** Deep clone of a (JSON-safe) game state. */
export function cloneState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

export interface ReplayResult {
  readonly state: GameState;
  readonly events: GameEvent[];
}

/**
 * Re-run a game from genesis + an ordered action log. Throws on the first illegal action,
 * naming it — this is the canonical audit/recovery path; a clean replay reproduces the live
 * state exactly (verified via stateDigest).
 */
export function replay(board: Board, config: GameConfig, actions: readonly Action[]): ReplayResult {
  let state = initGame(board, config);
  const events: GameEvent[] = [];
  actions.forEach((action, i) => {
    const res = reduce(board, state, action);
    if (!res.ok) {
      throw new Error(
        `replay: action #${i} (${action.t}) rejected: ${res.error.code} — ${res.error.message}`,
      );
    }
    state = res.value.state;
    events.push(...res.value.events);
  });
  return { state, events };
}
