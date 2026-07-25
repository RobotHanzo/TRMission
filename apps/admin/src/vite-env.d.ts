/// <reference types="vite/client" />

// Build-time configuration, baked into the public bundle — only values that are public by design.
// The source-map upload token is NOT one of them; it is read from process.env in vite.config.ts.
interface ImportMetaEnv {
  /** Commit the bundle was built from (Docker build-arg → Overview panel → Sentry release). */
  readonly VITE_COMMIT_HASH?: string;
  /** Dev-only origin of the main web app (see lib/mainApp.ts). */
  readonly VITE_WEB_ORIGIN?: string;
  /** Sentry ingest DSN. Unset ⇒ error reporting, tracing and replay are all off. */
  readonly VITE_SENTRY_DSN?: string;
  /** Sentry environment tag; defaults to development in dev, production otherwise. */
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** Fraction of page loads/navigations traced (0–1, clamped). Default 0.1. */
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  /** Fraction of ORDINARY sessions recorded by Session Replay (0–1). Default 0 — off. */
  readonly VITE_SENTRY_REPLAY_SAMPLE_RATE?: string;
  /** Fraction of ERRORING sessions whose buffered replay is kept (0–1). Default 1. */
  readonly VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
