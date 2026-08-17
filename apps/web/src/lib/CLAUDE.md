# Lib (`apps/web/src/lib/`)

App-wide context: `apps/web/CLAUDE.md`.

## `mobileApp.ts` — who gets the "get the app" sheet

`detectMobilePlatform()` answers **"is there a public store listing for this device?"**, not "is this
a phone": it returns `'ios'` for an iPhone/iPad (including iPadOS's default desktop-mode UA, which
claims to be a Mac — the touch-points test is what catches it) and `null` for everything else.
**Android is deliberately excluded** while the Play listing is an internal-testing track, since a
Play link answers "item not found" for non-testers; the module comments the one-line change that
lights it up. The dismissal (`trm.appPromptDismissed`) is per-device and permanent — declining OR
leaving for the store both count as answered. `MobileAppPrompt.tsx` is the only consumer.

## `preloadRecovery.ts` — surviving a redeploy, and a flaky network

Installed from `main.tsx`; answers Vite's `vite:preloadError`. Every route is a lazy chunk, so a tab
left open across a redeploy asks for asset hashes that no longer exist and crashes the root
boundary. It reloads once per minute-window to pick up the new `index.html`; beyond that it lets the
error through, because reloading is no longer the fix. `preventDefault()` and the reload are a pair
— cancelling without reloading hands `React.lazy` an undefined module. nginx backs this up:
`/assets/` 404s instead of falling through to the SPA shell, so a stale asset can't be answered with
`index.html` at 200.

**`lazyChunk()` is the other half of that pair, and every lazy route in `App.tsx` must load through
it** — `no-restricted-imports` bans `lazy` from `react` everywhere under `apps/web/src` except this
file, so that is a lint error, not a convention. `location.reload()` doesn't stop the microtasks already queued, so
the cancelled import still resolved — with `undefined` — and the module mapper threw on the way out
(TRMISSION-WEB-7). It leaves the promise permanently pending once a reload is in flight instead, and
retries a failed import **once** before surfacing it, so a phone changing networks mid-game gets a
slower load rather than a crash screen (TRMISSION-WEB-8). A chunk that fails twice with no reload
pending still reaches the boundary and Sentry, where a real asset failure belongs.
