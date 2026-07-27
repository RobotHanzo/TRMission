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
 */

/** Reload markers live in sessionStorage: per-tab, and gone when the tab is. */
const LAST_RELOAD_KEY = 'trm.preloadReload';
/** One recovery reload per window. A second failure this soon is not a stale deploy — it's a
 *  broken/blocked asset path, and reloading again would just spin. */
const RELOAD_COOLDOWN_MS = 60_000;

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

export function installPreloadRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('vite:preloadError', (event) => {
    const at = Date.now();
    if (at - lastReloadAt() < RELOAD_COOLDOWN_MS) return; // let it surface: reloading isn't fixing it
    event.preventDefault();
    markReloaded(at);
    window.location.reload();
  });
}
