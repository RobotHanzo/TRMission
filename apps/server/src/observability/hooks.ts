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
}

export const NOOP_METRICS: MetricsHooks = {
  commandReceived() {},
  commandRejected() {},
  commandApplied() {},
  connectionOpened() {},
  connectionClosed() {},
  leakBlocked() {},
  botDriverStalled() {},
};
