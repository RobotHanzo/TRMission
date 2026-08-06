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

| Area                                              | Doc                                |
| ------------------------------------------------- | ---------------------------------- |
| Skia board, camera, LOD, hit-testing              | `src/board/CLAUDE.md`              |
| GameStage seam, layout tiers, builder screen      | `src/screens/CLAUDE.md`            |
| In-game components, animation layer               | `src/components/game/CLAUDE.md`    |
| REST/WS transport, auth methods                   | `src/net/CLAUDE.md`                |
| Offline games + bots                              | `src/offline/CLAUDE.md`            |
| Tutorial (P4)                                     | `src/features/tutorial/CLAUDE.md`  |
| Push notifications, Expo Go gate                  | `src/push/CLAUDE.md`               |
| AdMob placements, consent/ATT, opt-out, the pin   | `src/ads/CLAUDE.md`                |
| Moderation, settings, session stores              | `src/store/CLAUDE.md`              |
| Haptics, game view logic                          | `src/game/CLAUDE.md`               |
| Orientation, layout tiers, Sentry + crash capture | `src/app/CLAUDE.md`                |
| Web-harness bundling, platform splits             | `src/web/CLAUDE.md`                |
| Live Activities (iOS)                             | `modules/live-activity/CLAUDE.md`  |
| CNG config plugins (pbxproj injection)            | `plugins/CLAUDE.md`                |
| jest mock infrastructure                          | `__mocks__/CLAUDE.md`              |
| Build/release/OTA lanes + CI secrets              | repo `.github/workflows/CLAUDE.md` |
| OTA mechanism, fingerprint rules, runbook         | repo `docs/mobile/ota.md`          |

## Stack & pins

- **Expo SDK 57** (RN 0.86, React 19.2.3, New Architecture, Hermes). `expo-*` modules use SDK 57's
  unified `~57.0.x` versioning — reconcile any dep via `npx expo install --check`, not by hand.
  The SDK's `bundledNativeModules.json` is the native compatibility contract and **outranks npm
  `latest`**: it deliberately holds several packages below their newest release (async-storage
  2.2.0, gesture-handler ~2.32, webview 13.16.1, worklets 0.10.1, skia 2.6.2). Don't "upgrade"
  those past the SDK.
- **React Navigation 7** native-stack (not Expo Router — few screens, heavily custom UI).
- **jest 29** (NOT 30): `jest-expo@57` is still a jest-29 preset (its deps pin `babel-jest`,
  `@jest/globals` and `jest-environment-jsdom` to ^29); a jest-30 runtime collides with its
  jest-29 internals. Keep the whole `jest*` stack on 29 — and `@testing-library/react-native` on
  **13**, since v14 swaps the `react-test-renderer` peer for the new `test-renderer` package that
  the jest-expo preset does not wire up.
- **`react-native-google-mobile-ads` pinned exact to 16.3.4** (issue #50) — a Kotlin-toolchain
  collision, not a preference; `src/ads/CLAUDE.md` has the reason and the policy boundary on
  placements.
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
(realpath → `packages/*`, transformed by babel-jest). Sentry additionally requires
`getSentryExpoConfig` here — `src/app/CLAUDE.md`.

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
this surface; a device smoke is still the real acceptance bar. How it's bundled (entry ordering,
platform splits, the alert shim): `src/web/CLAUDE.md`.

- **Pointing at a server**: `TRM_SERVER_ORIGIN=http://localhost:3001 yarn workspace @trm/mobile web`,
  and start the server with `CORS_ORIGINS=http://localhost:8081` — the browser enforces CORS where
  native clients don't. The origin bakes into the bundle at TRANSFORM time and survives Metro
  restarts in the transform cache: after changing it, start once with
  `npx expo start --web --clear`.
- **Alerts** become native browser dialogs, so Playwright must handle them as such
  (`browser_handle_dialog` / `page.on('dialog')`).
- **Selectors**: RNW emits `testID` as `data-testid`; the accessibility tree mirrors RN
  accessibility props (roles/labels), so a11y snapshots are the primary way to target UI.

## OTA updates (expo-updates + self-hosted expo-open-ota)

`app.config.ts` pins `runtimeVersion: { policy: 'fingerprint' }` and code-signing against the
committed `certs/certificate.pem`; `updates.url`/channel/app-id come from `TRM_OTA_URL` /
`TRM_OTA_CHANNEL` / `TRM_OTA_APP_ID` (the `expo-app-id` header is **omitted, not blanked, when
unset**). The private key in `certs/keys/` is gitignored and must never be committed. Full contract,
runbook, rollback and fallbacks: `docs/mobile/ota.md`; host setup:
`docs/release/ota-server-setup.md`.

Three rules bind any edit to `app.config.ts` or `fingerprint.config.js`:

1. **Anything a fingerprint-visible field reads from env makes the runtime version depend on which
   lane evaluated the config**, so the OTA lane and both store lanes must bake identical values.
   `TRM_GOOGLE_IOS_URL_SCHEME` is the one that bit us — a config-plugin prop, hashed for Android
   even though its native effect is iOS-only, so no Android device ever saw an OTA (issue #62).
   `scripts/fingerprintEnv.js` is the gate: `--assert` in every CI env block that evaluates the
   config, `--audit` on mobile-ci.
2. **Nothing the app must trust across an update may come from `extra` or `expoConfig.version`** —
   `fingerprint.config.js` skips `ExpoConfigVersions` + `ExpoConfigExtraSection` (issue #55), so
   `src/config.ts` reads `BUILD_NUMBER`/`APP_VERSION` off the native binary via expo-application
   instead. The forced-update gate `GET /version/mobile` compares that build number.
3. **Adding a dependency/plugin or editing `fingerprint.config.js` changes every runtime version** —
   the next OTA after such a change needs a fresh native build on both stores first.
