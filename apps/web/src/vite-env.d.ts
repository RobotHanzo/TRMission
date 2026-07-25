/// <reference types="vite/client" />

// Build-time configuration. Everything declared here is baked into the PUBLIC bundle, so it may
// only hold values that are public by design — a Sentry DSN is (it is an ingest endpoint, not a
// credential); the source-map upload auth token is NOT, and stays a build-machine-only env var
// read in vite.config.ts, never an `import.meta.env` key.
interface ImportMetaEnv {
  /** Commit the bundle was built from (Docker build-arg → About panel → Sentry release). */
  readonly VITE_COMMIT_HASH?: string;
  /** Dev-only origin of the admin app (see lib/adminApp.ts). */
  readonly VITE_ADMIN_ORIGIN?: string;
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
