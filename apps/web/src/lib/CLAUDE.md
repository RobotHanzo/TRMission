# Lib (`apps/web/src/lib/`)

App-wide context: `apps/web/CLAUDE.md`.

## `preloadRecovery.ts` — surviving a redeploy

Installed from `main.tsx`; answers Vite's `vite:preloadError`. Every route is a lazy chunk, so a tab
left open across a redeploy asks for asset hashes that no longer exist and crashes the root
boundary. It reloads once per minute-window to pick up the new `index.html`; beyond that it lets the
error through, because reloading is no longer the fix. `preventDefault()` and the reload are a pair
— cancelling without reloading hands `React.lazy` an undefined module. nginx backs this up:
`/assets/` 404s instead of falling through to the SPA shell, so a stale asset can't be answered with
`index.html` at 200.
