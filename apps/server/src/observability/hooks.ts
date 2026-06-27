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
}

export const NOOP_METRICS: MetricsHooks = {
  commandReceived() {},
  commandRejected() {},
  commandApplied() {},
  connectionOpened() {},
  connectionClosed() {},
  leakBlocked() {},
};
