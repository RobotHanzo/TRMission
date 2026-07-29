# App shell (`apps/mobile/src/app/`)

App-wide context: `apps/mobile/CLAUDE.md`.

## Orientation & layout tiers (`useOrientationPolicy.ts`, `layoutTiers.ts`)

Phones (smallest window side < 600dp) lock PORTRAIT_UP; tablets stay unlocked — and Android 16+
ignores lock requests on ≥600dp anyway, so every screen must survive free rotation/resize.
`stageTier` (compact < 700dp ≤ two-pane < 1000dp ≤ three-pane) is measured from live window
width, never device type. The stage's use of those tiers: `../screens/CLAUDE.md`.

## Error reporting (`sentry.ts`, issue #44)

`@sentry/react-native` + its `'@sentry/react-native/expo'` config plugin. Opt-in via
`TRM_SENTRY_DSN` → `extra.sentryDsn` → `../config.ts`; unset ⇒ `Sentry.init` is never called.
Initialised from `index.ts` right after the shims and `installCrashCapture()`, and skipped entirely
on the RNW web harness.

- **`crashCapture.ts` stays.** It is the offline/TestFlight fallback (AsyncStorage → Settings share
  sheet) and needs no network or account; Sentry is the online path. `RootErrorBoundary` writes the
  local record **first**, then reports. Deliberately independent — a wedged network must not cost us
  the report we already have locally.
- The plugin is passed **no props**: org/project/token come from `SENTRY_ORG`/`SENTRY_PROJECT`/
  `SENTRY_AUTH_TOKEN` at build time, which keeps the plugin entry (and so the OTA fingerprint)
  identical whether or not a Sentry account is configured.
- **`metro.config.js` must use `getSentryExpoConfig`, never `getDefaultConfig` + `withSentryConfig`.**
  The latter is Sentry's bare-RN path: it wraps Expo's `serializer.customSerializer` in its own, and
  on Metro 0.84 (SDK 56) Expo's serializer result is no longer the shape Sentry expects, so every
  **release** bundle dies in `determineDebugIdFromBundleSource` ("Cannot read properties of
  undefined (reading 'match')"). Dev bundling early-returns before that code, so the breakage is
  invisible until `createBundleReleaseJsAndAssets` runs in CI — verify a config change with
  `npx expo export:embed --platform android --dev false ...`, not with `expo start`.
- **Adding the dependency changed the `runtimeVersion` fingerprint**: the first OTA published after
  this landed needs a fresh native build on both stores first, or no installed binary will match it.
- `TRM_SENTRY_*` must be set on **every** env block that re-evaluates `app.config.ts` — both store
  lanes AND the OTA publish lane, because an applied update's manifest replaces the binary's
  `extra`. Same lockstep rule as the Google client ids (`../../CLAUDE.md` → OTA).
- **Mobile Session Replay is wired but OFF** (both sample rates default to 0). It records the
  screen, which on a hidden-information game includes the player's hand, and the Skia board is a
  single native view whose masking has not been verified on a device. Verify masking on a real
  device before raising either rate.
- The iOS privacy manifest declares crash/performance/other-diagnostic collection as **linked to
  identity, not tracking** — keep it in step if the SDK's collection changes, and keep App Store
  Connect's questionnaire saying the same (`docs/release/app-store-connect-setup.md` §11).
- **Mobile stays id-only, unlike web/admin — but id-only is still _linked_.** The shared denylist
  was narrowed in 2026-07 so identifiers (email, IP) reach Sentry, and web/admin now attach
  `{ id, email, username }` with `sendDefaultPii: true`. This surface deliberately did **not**
  follow: it sets `sendDefaultPii: false` and `Sentry.setUser({ id })`. That keeps emails and IPs
  off events, which narrows WHAT is linked — it does not make the data unlinked. Apple's test is
  association with the user's account through ANY identifier, and a server-minted account id is
  one, so `NSPrivacyCollectedDataTypeLinked: true` is the honest declaration for a build that calls
  `setSentryUser`. Going back to `false` means dropping the `setUser` call; do the manifest edit and
  the SDK change in the same release or neither — it moves the OTA fingerprint, so either way it
  needs a fresh native build on both stores.
