/**
 * The eager-side Sentry façade — the ONLY observability module the app graph imports directly.
 *
 * It deliberately contains no `@sentry/*` import. The SDK is ~92 kB gzipped; a static import would
 * put it on the boot critical path of every page load, including the many builds that ship with no
 * DSN at all (dev, tests, anyone self-hosting this repo). Instead `initSentry()` checks for a DSN
 * first and only then dynamically imports `./sentry`, so an unconfigured build never fetches a byte
 * of it and a configured one fetches it off the critical path.
 *
 * The cost of that trade is a short window at boot before the SDK lands, during which reports are
 * dropped rather than queued — deliberately, because a queue that outlives the page would be a
 * second place for game state to sit. User/game context set during the window is not dropped: the
 * latest value is held here and applied once the SDK is live.
 */

/** Who hit the error. Identifiers, deliberately: an account id alone forces a DB lookup before
 *  anyone can even tell whether a report matters. Guests have no email — the id carries them. */
export interface TelemetryUser {
  id: string;
  email?: string;
  username?: string;
}

/** The subset of `./sentry` this façade drives, once it has loaded. */
export interface SentryHandle {
  captureException(error: unknown, componentStack?: string): string;
  setUser(user: TelemetryUser | null): void;
  setGameContext(context: { gameId?: string; roomCode?: string } | null): void;
}

let handle: SentryHandle | null = null;
let pendingUser: TelemetryUser | null = null;
let pendingGame: { gameId?: string; roomCode?: string } | null = null;
let started = false;

/**
 * Start Sentry if `VITE_SENTRY_DSN` is set. Returns whether a load was kicked off — not whether the
 * SDK is live yet, which happens a tick later. Called once from `main.tsx`. Idempotent.
 */
export function initSentry(): boolean {
  if (started) return handle !== null;
  started = true;
  if (!import.meta.env.VITE_SENTRY_DSN) return false;

  void import('./sentry')
    .then((module) => {
      handle = module.start();
      // Replay whatever context was set while the chunk was in flight.
      handle.setUser(pendingUser);
      handle.setGameContext(pendingGame);
    })
    .catch(() => {
      // A blocked/failed chunk fetch (offline, ad-blocker, CSP) must never break the app: the
      // page simply runs without error reporting, exactly as an unconfigured build does.
    });
  return true;
}

/**
 * Report a render error caught by the root boundary. Returns the Sentry event id — the reference a
 * user can quote — or null when reporting is off or the SDK has not loaded yet.
 */
export function reportRenderError(error: unknown, componentStack?: string): string | null {
  return handle ? handle.captureException(error, componentStack) : null;
}

/** Attach (or clear) the signed-in account — id, email and display name. */
export function setSentryUser(user: TelemetryUser | null): void {
  pendingUser = user;
  handle?.setUser(user);
}

/** Tag the game/room a report came from, so in-game errors group by match. Null clears it. */
export function setSentryGameContext(context: { gameId?: string; roomCode?: string } | null): void {
  pendingGame = context;
  handle?.setGameContext(context);
}
