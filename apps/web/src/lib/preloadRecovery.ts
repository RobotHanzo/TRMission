/**
 * Recovery for lazy-chunk fetches that fail because the deployment moved under an open tab
 * (TRMISSION-WEB-5: `Unable to preload CSS for /assets/RoomScreen-<hash>.css`).
 *
 * Every route in `App.tsx` is a `lazy()` chunk, so a tab left open across a redeploy still holds
 * the OLD asset hashes. The moment it navigates to a route it hasn't loaded yet, Vite's preload
 * helper asks for a file that no longer exists and the rejection reaches the root error boundary —
 * the user gets a crash screen for what is really just a stale page.
 *
 * Vite dispatches a cancelable `vite:preloadError` on `window` first, so we take it there instead:
 * a full reload re-fetches `index.html` and lands on the current asset hashes. Reloading is only
 * safe when we ACTUALLY reload — `preventDefault()` alone would let the import continue and hand
 * `React.lazy` an undefined module. So the two go together, and when we decline to reload we let
 * the error through to the boundary (and Sentry), where a persistent asset failure belongs.
 *
 * `lazyChunk()` below is the other half of that contract: cancelling the error resolves the import
 * with `undefined`, and `location.reload()` does not stop the microtasks already queued behind it,
 * so without a guard the module mapper still runs during teardown and throws (TRMISSION-WEB-7:
 * `undefined is not an object (evaluating 'e.GameScreen')`). Every lazy route must load through it.
 */
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/** Reload markers live in sessionStorage: per-tab, and gone when the tab is. */
const LAST_RELOAD_KEY = 'trm.preloadReload';
/** One recovery reload per window. A second failure this soon is not a stale deploy — it's a
 *  broken/blocked asset path, and reloading again would just spin. */
const RELOAD_COOLDOWN_MS = 60_000;
/** A chunk fetch that fails on a flaky connection (a phone changing networks mid-game) is not a
 *  stale deploy and a reload won't fix it — one retry turns it into a slower load instead of a
 *  crash screen. Long enough for a handover to settle, short enough to stay a spinner. */
const RETRY_DELAY_MS = 600;

/** sessionStorage throws in some privacy modes; the recovery is best-effort, never a new crash. */
function lastReloadAt(): number {
  try {
    return Number(sessionStorage.getItem(LAST_RELOAD_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markReloaded(at: number): void {
  try {
    sessionStorage.setItem(LAST_RELOAD_KEY, String(at));
  } catch {
    /* no marker → the cooldown can't be enforced; the reload below still happens once */
  }
}

let installed = false;
/** Set the moment we cancel a preload error and ask for a fresh `index.html`. The page is on its
 *  way out from here: nothing waiting on a chunk should surface an error or render a screen. */
let reloading = false;

/** Never settles, so React keeps the Suspense fallback up until the reload navigates away. */
const PENDING_FOREVER: Promise<never> = new Promise(() => {});

export function installPreloadRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('vite:preloadError', (event) => {
    const at = Date.now();
    if (at - lastReloadAt() < RELOAD_COOLDOWN_MS) return; // let it surface: reloading isn't fixing it
    event.preventDefault();
    reloading = true;
    markReloaded(at);
    window.location.reload();
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt<M>(load: () => Promise<M>): Promise<M> {
  const mod = await load();
  // Vite's preload helper resolves the import with `undefined` when a `vite:preloadError` was
  // cancelled — which only ever happens above, with a reload already in flight.
  if (mod !== undefined) return mod;
  if (reloading) return PENDING_FOREVER;
  throw new Error('lazy chunk resolved to no module');
}

/**
 * Run a dynamic import under the recovery contract: retried once, and left permanently pending
 * (rather than resolving `undefined` or rejecting) once a recovery reload has been triggered.
 * `lazyChunk` is this plus `React.lazy`; call it directly for a non-component chunk.
 */
export async function loadChunk<M>(load: () => Promise<M>): Promise<M> {
  if (reloading) return PENDING_FOREVER;
  try {
    return await attempt(load);
  } catch {
    if (reloading) return PENDING_FOREVER;
    await sleep(RETRY_DELAY_MS);
    if (reloading) return PENDING_FOREVER;
    // Second and last try: a still-failing chunk is a real asset/network failure, and belongs on
    // the error boundary (and in Sentry) rather than behind an endless spinner.
    return attempt(load);
  }
}

/** What `React.lazy` itself is typed against — matching it is what lets a screen that takes props
 *  (EncyclopediaModal) and one that takes none share this helper. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

/**
 * `React.lazy` for a route chunk, with the recovery contract above applied to the import: one
 * retry for a transient fetch failure, and no module dereference at all once a recovery reload has
 * been triggered. Pass `pick` for a module that exports the screen by name.
 */
export function lazyChunk<T extends AnyComponent>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T>;
export function lazyChunk<M, T extends AnyComponent>(
  load: () => Promise<M>,
  pick: (mod: M) => T,
): LazyExoticComponent<T>;
export function lazyChunk<M, T extends AnyComponent>(
  load: () => Promise<M>,
  pick?: (mod: M) => T,
): LazyExoticComponent<T> {
  return lazy(() =>
    loadChunk(load).then((mod) => ({
      default: pick ? pick(mod) : (mod as { default: T }).default,
    })),
  );
}
