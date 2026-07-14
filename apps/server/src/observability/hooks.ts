// Metrics seam for the hub. Defined without prom-client so the realtime core stays
// dependency-free and trivially testable (tests pass NOOP_METRICS).
export interface MetricsHooks {
  commandReceived(): void;
  commandRejected(code: string): void;
  commandApplied(seconds: number): void;
  connectionOpened(): void;
  connectionClosed(): void;
  /** Incremented if the egress guard ever catches a snapshot addressed to the wrong player. */
  leakBlocked(): void;
  /**
   * Incremented when the bot driver can't make progress on a bot's turn: either the policy (plus
   * the PASS fallback) found no legal action at all, or a write-ahead persist kept failing. Should
   * stay at 0 — an increase means a match may be stuck waiting on a turn nothing will ever prompt
   * again (see `GameHub.driveBots`).
   */
  botDriverStalled(reason: 'no_legal_action' | 'persist_failed'): void;
  /**
   * A persisted game could not be brought back (incompatible engine major, or a snapshot+tail that
   * no longer replays). The affected players can't resume that game — alert on any increase.
   */
  recoveryFailed?(): void;
  /** A player's per-turn timer lapsed and the server auto-played a default action for them. */
  turnTimedOut?(): void;
  /** An inbound frame threw somewhere unexpected. Should stay at 0; each one is a bug. */
  internalError?(): void;
}

export const NOOP_METRICS: MetricsHooks = {
  commandReceived() {},
  commandRejected() {},
  commandApplied() {},
  connectionOpened() {},
  connectionClosed() {},
  leakBlocked() {},
  botDriverStalled() {},
  recoveryFailed() {},
  internalError() {},
  turnTimedOut() {},
};
