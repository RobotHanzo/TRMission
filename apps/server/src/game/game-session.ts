// The authoritative live game. It owns the engine GameState; mutation goes through
// `prepare` (pure — compute the next state) then `commit` (apply it), so the hub can
// write-ahead persist between the two. `apply` = prepare+commit for callers that don't
// persist (recovery, tests). `restore` rebuilds a session from a stored snapshot + the
// tail of recorded actions, the basis of crash recovery and the determinism tests.
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

/** A computed-but-not-yet-committed action result (write-ahead log: persist, then commit). */
export interface Prepared {
  readonly state: GameState;
  readonly events: GameEvent[];
  readonly stateVersion: number;
  readonly digest: string;
}

export type PrepareResult =
  | { readonly ok: true; readonly prepared: Prepared }
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

  /** Pure: compute the result without mutating, so the hub can persist before committing. */
  prepare(action: Action): PrepareResult {
    const res = reduce(this.board, this.state, action);
    if (!res.ok) return { ok: false, violation: res.error };
    return {
      ok: true,
      prepared: {
        state: res.value.state,
        events: res.value.events,
        stateVersion: res.value.state.actionSeq,
        digest: stateDigest(res.value.state),
      },
    };
  }

  /** Commit a previously prepared result (after it has been durably persisted). */
  commit(prepared: Prepared, action: Action): void {
    this.state = prepared.state;
    this.appliedActions.push(action);
  }

  apply(action: Action): ApplyResult {
    const p = this.prepare(action);
    if (!p.ok) return { ok: false, violation: p.violation };
    this.commit(p.prepared, action);
    return { ok: true, events: p.prepared.events, stateVersion: p.prepared.stateVersion };
  }

  /**
   * Rebuild a live session from a base snapshot (or genesis) + the tail of recorded
   * actions, verifying each step's digest against what was stored. A mismatch means the
   * persisted log diverged from the engine — recovery aborts rather than resume a corrupt
   * game (risk #2/#3).
   */
  static restore(
    gameId: string,
    board: Board,
    config: GameConfig,
    snapshotState: GameState | null,
    tail: ReadonlyArray<{ action: Action; stateDigest: string }>,
  ): GameSession {
    const s = new GameSession(gameId, board, config);
    if (snapshotState) s.state = snapshotState;
    for (const { action, stateDigest: expected } of tail) {
      const res = s.apply(action);
      if (!res.ok)
        throw new Error(
          `recovery: action at seq ${s.stateVersion} rejected: ${res.violation.code}`,
        );
      if (s.digest() !== expected)
        throw new Error(`recovery: digest mismatch at seq ${s.stateVersion}`);
    }
    return s;
  }

  /** Per-viewer projection (the ONLY thing that should ever reach the wire). */
  project(viewer: PlayerId | null): RedactedView {
    return redactFor(this.state, viewer);
  }
}
