/**
 * The eager-side Sentry façade — the ONLY observability module the dashboard imports directly.
 *
 * No `@sentry/*` import lives here on purpose. `initSentry()` checks for a DSN first and only then
 * dynamically imports `./sentry`, so a build without one never downloads the SDK at all (Vite
 * inlines the missing env var, which makes the whole import dead code and drops it from the
 * bundle). Same contract as apps/web's `observability/report.ts`.
 */

/** Which maintainer hit the error. Identifiers, deliberately — on a surface with a handful of
 *  operators, "which one" is usually the fastest route to "what were they doing". */
export interface TelemetryUser {
  id: string;
  email?: string;
  username?: string;
}

/** The subset of `./sentry` this façade drives, once it has loaded. */
export interface SentryHandle {
  captureException(error: unknown, componentStack?: string): string;
  setUser(user: TelemetryUser | null): void;
}

let handle: SentryHandle | null = null;
let pendingUser: TelemetryUser | null = null;
let started = false;

/** Start Sentry if `VITE_SENTRY_DSN` is set. Called once from `main.tsx`. Idempotent. */
export function initSentry(): boolean {
  if (started) return handle !== null;
  started = true;
  if (!import.meta.env.VITE_SENTRY_DSN) return false;

  void import('./sentry')
    .then((module) => {
      handle = module.start();
      handle.setUser(pendingUser);
    })
    .catch(() => {
      // A blocked/failed chunk fetch must never break the dashboard — it simply runs without
      // error reporting, exactly as an unconfigured build does.
    });
  return true;
}

/**
 * Report a render error caught by the root boundary. Returns the Sentry event id, or null when
 * reporting is off or the SDK has not loaded yet.
 */
export function reportRenderError(error: unknown, componentStack?: string): string | null {
  return handle ? handle.captureException(error, componentStack) : null;
}

/** Attach (or clear) the signed-in maintainer — id, email and display name. */
export function setSentryUser(user: TelemetryUser | null): void {
  pendingUser = user;
  handle?.setUser(user);
}
