# CLAUDE.md

`apps/mobile` is the React Native + Expo client (`@trm/mobile`) — native Android + iOS apps that
reuse the pure-TS `@trm/*` packages and authenticate against the P0 mobile server surface. It renders
the server's authoritative state and never computes game truth itself (same contract as `apps/web`).

```bash
yarn workspace @trm/mobile start        # Metro dev server (Expo)
yarn workspace @trm/mobile web          # react-native-web harness on :8081 (see "Web harness")
yarn workspace @trm/mobile typecheck    # tsc --noEmit
yarn workspace @trm/mobile lint         # eslint src (root flat config)
yarn workspace @trm/mobile test         # jest (jest-expo preset)
TRM_SERVER_ORIGIN=http://<lan-ip>:3001 yarn workspace @trm/mobile start   # point at a dev server
```

## Where the per-area docs live

Read the one for the area you're touching (Claude Code loads them on demand):

| Area                                         | Doc                               |
| -------------------------------------------- | --------------------------------- |
| Skia board, camera, LOD, hit-testing         | `src/board/CLAUDE.md`             |
| GameStage seam, layout tiers, builder screen | `src/screens/CLAUDE.md`           |
| In-game components, animation layer          | `src/components/game/CLAUDE.md`   |
| REST/WS transport, auth methods              | `src/net/CLAUDE.md`               |
| Offline games + bots                         | `src/offline/CLAUDE.md`           |
| Tutorial (P4)                                | `src/features/tutorial/CLAUDE.md` |
| Push notifications, Expo Go gate             | `src/push/CLAUDE.md`              |
| AdMob placements, consent/ATT, opt-out       | `src/ads/CLAUDE.md`               |
| Moderation, settings, session stores         | `src/store/CLAUDE.md`             |
| Haptics, game view logic                     | `src/game/CLAUDE.md`              |
| Orientation & layout tiers                   | `src/app/CLAUDE.md`               |
| Live Activities (iOS)                        | `modules/live-activity/CLAUDE.md` |
| CNG config plugins (pbxproj injection)       | `plugins/CLAUDE.md`               |
| jest mock infrastructure                     | `__mocks__/CLAUDE.md`             |
| Build/release/OTA lanes + CI secrets         | `.github/workflows/CLAUDE.md`     |
| OTA mechanism, runbook, rollback             | `docs/mobile/ota.md`              |

## Stack & pins

- **Expo SDK 56** (RN 0.85, React 19.2, New Architecture, Hermes). `expo-*` modules use SDK 56's
  unified `~56.0.x` versioning — reconcile any dep via `npx expo install --check`, not by hand.
- **React Navigation 7** native-stack (not Expo Router — few screens, heavily custom UI).
- **jest 29** (NOT 30): `jest-expo@56` is a jest-29 preset; a jest-30 runtime collides with its
  jest-29 internals. Keep the whole `jest*` stack on 29.
- **Google AdMob** (`react-native-google-mobile-ads`, **pinned exact to 16.3.4**, issue #50) — two
  placements only, both policy-bounded; `src/ads/CLAUDE.md` is the contract. The pin is load-bearing:
  16.4.0 bumps the native SDK to play-services-ads 25.4.0, whose Kotlin metadata is 2.3.0 and cannot
  be read by Expo SDK 56 / RN 0.85's Kotlin 2.1.20 toolchain (`:react-native-google-mobile-ads:`
  `compileReleaseKotlin` fails). Bumping `kotlinVersion` instead breaks other autolinked modules
  (upstream invertase#863), so keep the caret off until Expo's own Kotlin catches up. Its config plugin's props are literals in
  `app.config.ts`, never env, because plugin props feed the OTA fingerprint. **Adding the plugin
  changed that fingerprint**: the first OTA after it landed needs a fresh native build on both
  stores. AdMob is also what flipped `NSPrivacyTracking` to true and unblocked Android's `AD_ID`.
- **No EAS, no Expo push service, no _paid_ SaaS.** Builds run in GitHub Actions + fastlane; OTA (P5)
  is self-hosted; push (P0 server) is direct FCM/APNs — the app only registers native device tokens.
  Free / open-source hosted services are allowed where they neither bill nor lock us in (e.g. RNRepo's
  public GPG-signed prebuilt-artifact Maven via `@rnrepo/expo-config-plugin`, used to cut the Android
  CI native build; it auto-falls back to source per library). EAS and any paid relay stay out. This
  re-aligns with the design spec, which already scoped the ban to "no _paid_ SaaS in the delivery chain."
  **Sentry** (issue #44) sits inside that carve-out: it is not in the delivery chain, its free tier
  is sufficient, and it is self-hostable — and the whole integration is DSN-gated, so a build with
  no DSN never talks to it at all.
- Yarn 4 `nodeLinker: node-modules` (Metro can't resolve PnP). `apps/mobile/{android,ios,.expo}` are
  git-ignored — Continuous Native Generation regenerates them via `expo prebuild` in CI.

## Monorepo resolution (metro.config.js)

The `@trm/*` packages export raw TS via an `exports` map with no `main`, consumed with no build step
(same as Vite does for web). Metro is configured with `watchFolders = [workspaceRoot]`,
`nodeModulesPaths` (app → hoisted root), and `unstable_enablePackageExports = true` (asserted, not
assumed — a Metro default flip fails loud). jest resolves the same TS source through symlinks
(realpath → `packages/*`, transformed by babel-jest).

## Load-bearing Hermes shims (`src/shims.ts`, imported first from `index.ts`)

Three polyfills, all self-guarding (no-op on Node/jest, active only on Hermes):

1. **`@formatjs/intl-pluralrules`** (+ en/zh locale data) — Hermes' `Intl.PluralRules` is incomplete;
   i18next plural selection needs it.
2. **`fast-text-encoding`** — Hermes ships `TextEncoder` but not a spec `TextDecoder`; protobuf-es's
   binary codec constructs `new TextDecoder("utf-8", { fatal: true })`.
3. Engine `cloneState` (in `@trm/engine`) has a `structuredClone`→JSON fallback for Hermes; the JSON
   path stays byte-identical so golden-replay digests hold.

## Web harness (react-native-web — for desktop/Playwright testing, NOT a shipped surface)

`yarn workspace @trm/mobile web` serves the app at http://localhost:8081 so agents can drive the
mobile UI with Playwright. Guest login, lobby/online play, offline bot games, and the tutorial all
work end-to-end (the Skia board renders through CanvasKit wasm). Never trade native quality for
this surface; a device smoke is still the real acceptance bar.

- **Pointing at a server**: `TRM_SERVER_ORIGIN=http://localhost:3001 yarn workspace @trm/mobile web`,
  and start the server with `CORS_ORIGINS=http://localhost:8081` — the browser enforces CORS where
  native clients don't. The origin bakes into the bundle at TRANSFORM time and survives Metro
  restarts in the transform cache: after changing it, start once with
  `npx expo start --web --clear`.
- **Entry** (`index.ts` web branch): CanvasKit must finish loading before the app graph EVALUATES
  (Skia's web modules read `global.CanvasKit` at import), so App is `require`d only after
  `LoadSkiaWeb` resolves. `scripts/setup-web.js` copies `canvaskit.wasm` → `public/` (gitignored);
  the `web` script runs it automatically.
- **Platform splits** (Metro resolves `.web.ts(x)` on web; jest/native never see them — they're
  typechecked standalone), each documented in its area's doc: `net/secureStore.web.ts`,
  `offline/localStore.web.ts`, `screens/builderWebView.web.tsx` (iframe),
  `board/BoardCanvas.web.tsx` + `board/webFonts.ts`, `components/game/CardRowScroll.web.tsx`.
  Gated to `null` on web like under Expo Go: `push/expoNotifications.ts`,
  `auth/googleSigninModule.ts`. Apple auth needs no gate (`requireOptionalNativeModule` stub;
  `isAvailableAsync()` → false).
- **Alerts**: RNW's `Alert.alert` is a silent no-op, so `src/web/alertShim.ts` (installed from the
  web entry branch) maps it onto `window.confirm`/`window.alert` — OK runs the LAST non-cancel
  button, Cancel the `style: 'cancel'` one. Playwright must handle these as native dialogs
  (`browser_handle_dialog` / `page.on('dialog')`).
- **Selectors**: RNW emits `testID` as `data-testid`; the accessibility tree mirrors RN
  accessibility props (roles/labels), so a11y snapshots are the primary way to target UI.

## Error reporting (`src/app/sentry.ts`, issue #44)

`@sentry/react-native` + its `'@sentry/react-native/expo'` config plugin. Opt-in via
`TRM_SENTRY_DSN` → `extra.sentryDsn` → `src/config.ts`; unset ⇒ `Sentry.init` is never called.
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
  `extra`. Same lockstep rule as the Google client ids.
- **Mobile Session Replay is wired but OFF** (both sample rates default to 0). It records the
  screen, which on a hidden-information game includes the player's hand, and the Skia board is a
  single native view whose masking has not been verified on a device. Verify masking on a real
  device before raising either rate.
- The iOS privacy manifest declares crash/performance/other-diagnostic collection (not linked to
  identity, not tracking) — keep it in step if the SDK's collection changes.

## OTA updates (expo-updates + self-hosted expo-open-ota)

`app.config.ts` pins `runtimeVersion: { policy: 'fingerprint' }` and code-signing against the
committed `certs/certificate.pem` (`fallbackToCacheTimeout: 0` — stale-while-revalidate; the
forced-update gate `GET /version/mobile` is independent and still runs every boot). `updates.url`
comes from `TRM_OTA_URL`, the channel from `TRM_OTA_CHANNEL` (`expo-channel-name` header), the app
from `TRM_OTA_APP_ID` (`expo-app-id` header — **omitted, not blanked, when unset**).
**Everything in `updates.requestHeaders` feeds the runtimeVersion fingerprint**, so the OTA lane and
the store lanes must bake identical values; the deployed server and the `eoas` CLI are pinned to the
same version because they only work in matched pairs. The private key in `certs/keys/` is gitignored
and must never be committed. Full contract, runbook, rollback, fallbacks: `docs/mobile/ota.md`;
host setup: `docs/release/ota-server-setup.md`.
