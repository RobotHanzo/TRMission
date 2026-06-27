// The authoritative in-memory game (Step A — no persistence yet). It owns the
// engine GameState; the only way to mutate it is `apply`, which runs the pure
// reducer and records the action so the whole game can be replayed deterministically
// (the basis for Step B persistence/recovery and for the determinism test).
import { initGame, reduce, redactFor, stateDigest, currentPlayerId } from '@trm/engine';
import type {
  Board,
  GameConfig,
  GameState,
  Action,
  GameEvent,
  RedactedView,
  Phase,
} from '@trm/engine';
import type { PlayerId, RuleViolation } from '@trm/shared';

export type ApplyResult =
  | { readonly ok: true; readonly events: GameEvent[]; readonly stateVersion: number }
  | { readonly ok: false; readonly violation: RuleViolation };

export class GameSession {
  private state: GameState;
  /** Ordered log of accepted actions — replays to the exact current state (A5). */
  readonly appliedActions: Action[] = [];

  constructor(
    readonly gameId: string,
    readonly board: Board,
    readonly config: GameConfig,
  ) {
    this.state = initGame(board, config);
  }

  get stateVersion(): number {
    return this.state.actionSeq;
  }
  get phase(): Phase {
    return this.state.turn.phase;
  }
  get turnOrder(): readonly PlayerId[] {
    return this.state.turnOrder;
  }
  get currentPlayer(): PlayerId | null {
    return this.phase === 'GAME_OVER' ? null : currentPlayerId(this.state);
  }

  digest(): string {
    return stateDigest(this.state);
  }

  /** Read-only access to authoritative state (server-side selectors / tests only — never the wire). */
  raw(): GameState {
    return this.state;
  }

  seatOf(player: PlayerId): number | null {
    return this.state.players[player as string]?.seat ?? null;
  }

  hasPendingOffer(player: PlayerId): boolean {
    return this.state.players[player as string]?.pendingTicketOffer != null;
  }

  apply(action: Action): ApplyResult {
    const res = reduce(this.board, this.state, action);
    if (!res.ok) return { ok: false, violation: res.error };
    this.state = res.value.state;
    this.appliedActions.push(action);
    return { ok: true, events: res.value.events, stateVersion: this.state.actionSeq };
  }

  /** Per-viewer projection (the ONLY thing that should ever reach the wire). */
  project(viewer: PlayerId | null): RedactedView {
    return redactFor(this.state, viewer);
  }
}
