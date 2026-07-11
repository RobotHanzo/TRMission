# CLAUDE.md

`apps/mobile` is the React Native + Expo client (`@trm/mobile`) — native Android + iOS apps that
reuse the pure-TS `@trm/*` packages and authenticate against the P0 mobile server surface. It renders
the server's authoritative state and never computes game truth itself (same contract as `apps/web`).

```bash
yarn workspace @trm/mobile start        # Metro dev server (Expo)
yarn workspace @trm/mobile typecheck    # tsc --noEmit
yarn workspace @trm/mobile lint         # eslint src (root flat config)
yarn workspace @trm/mobile test         # jest (jest-expo preset)
TRM_SERVER_ORIGIN=http://<lan-ip>:3001 yarn workspace @trm/mobile start   # point at a dev server
```

## Stack & pins

- **Expo SDK 56** (RN 0.85, React 19.2, New Architecture, Hermes). `expo-*` modules use SDK 56's
  unified `~56.0.x` versioning — reconcile any dep via `npx expo install --check`, not by hand.
- **React Navigation 7** native-stack (not Expo Router — few screens, heavily custom UI).
- **jest 29** (NOT 30): `jest-expo@56` is a jest-29 preset; a jest-30 runtime collides with its
  jest-29 internals. Keep the whole `jest*` stack on 29.
- **No EAS, no Expo push service, no SaaS.** Builds run in GitHub Actions + fastlane; OTA (P5) is
  self-hosted; push (P0 server) is direct FCM/APNs — the app only registers native device tokens.
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

## Board & game stage (P2)

- **Span-based camera** (`src/board/camera.ts` + `useBoardCamera.ts`): the camera IS the wire
  descriptor `{cx, cy, span}` (board units; span = visible board-width) — identical to the
  protobuf `CameraView`, so the myTurn camera broadcast and opponent camera-follow need zero
  projection math. Reanimated shared values drive a single Skia `<Group transform>`; gestures
  (pan/pinch, gesture-handler) mutate `cx/cy/span` on the UI thread.
- **Quantized LOD, not per-frame styles**: continuous zoom only moves the GPU transform. The
  React tree re-renders solely when the zoom crosses a quantized bucket
  (`cam.lod.{bucket,inv,marker}`), which resizes track weights / markers / label tiers.
  `HOME_SCALE_EQUIV = 2.4` anchors the span→scale-equivalent mapping the buckets are derived
  from. Never write JS-side styles per frame (the web's known jank source).
- **Manual hit-testing** (`src/board/hitTest.ts`, pure + unit-tested): Skia children aren't
  touch targets; a tap projects screen→board through the current camera and hit-tests routes
  (segment distance) and cities (radius) against the shared geometry.
- **One map scene** (`src/board/MapSceneSkia.tsx`): geography → routes → cities → labels →
  sweep overlays, purely presentational (mirrors web `MapScene.tsx`); every board surface
  renders through it. `BoardView` owns the Canvas, camera, glow/sweep timers, camera
  sync/follow, and the framers.
- **GameStage prop contract is the P3/P4 seam** (`src/screens/GameStage.tsx`): web-compatible
  `snapshot`/`commands` (`GameCommands` — live `GameSocket` or the offline/tutorial sandbox)
  plus `sandbox`/`frameTarget`/`overlay`/`spotlightCities`/`actionGate`. Adaptive tiers by
  width (`stageLayout.ts`): compact <700dp docks the HUD under a full-bleed board; 700–999
  two-pane (rail ↔ comms tabs); ≥1000 three-pane (dedicated comms column). Don't change this
  surface without checking the offline (P3) and tutorial (P4) callers.
- **Drivers**: `useAnimationDriver` (store→store; card flights/sweeps/floats/banners render in
  `components/game/AnimationLayer.tsx` via the measured `animTargets` registry) and
  `useSoundDriver` (expo-audio port — SDK 56 removed expo-av; same `SoundPlayer` interface as
  web) both mount once in GameStage.
- **jest mocks**: hand-rolled `__mocks__` for `@shopify/react-native-skia` (component stubs +
  truthy `SkPath`) and `lucide-react-native` (Proxy stubs — it ships `.mjs` outside the
  transform), the official `react-native-reanimated/mock`, and a composed `jest.resolver.js`
  (worklets `.native`-extension strip + the RN resolver) so reanimated 4 imports run under
  jest-expo. gesture-handler is covered by jest-expo's own setup.
- **react-native-svg fallback stance**: the P2 Task 1 device spike returned **GO** for Skia.
  The documented NO-GO fallback (react-native-svg under a single root transform) is
  _documented, not planned_ — see the P2 plan (Task 1) before ever revisiting renderers; do
  not silently switch.

## Net layer — deltas from `apps/web`

- `net/rest.ts` — port of the web REST client with two changes: an **absolute** `API_BASE` (no
  same-origin cookie jar) and **token-in-body refresh** (P0-a `x-trm-client: mobile`). The access
  token lives in memory; the refresh token lives in the OS keystore (`net/secureStore.ts`,
  `expo-secure-store`). A 401 rotates via `POST /auth/refresh {refreshToken}` under a single-flight
  guard, then persists the rotated token. Issuance captures both tokens.
- `net/socket.ts` — verbatim port of the protobuf `GameSocket` except the default URL is `WS_URL`
  (config, not `location`) and `ws.binaryType = 'arraybuffer'` is set explicitly.
- `store/session.ts` — port with a keystore-aware `restore()` (fast-paths when no refresh token
  exists), `loginWithApple`/`DiscordExchange`, `signInMethod` tracking, and push register/unregister.
- Auth screens drive all five P0 methods: guest, email/password, Google (native SDK → ID token),
  Apple (iOS, `expo-apple-authentication`), Discord (system browser → `/m/callback` exchange code).

Strings are `x-trm-client: mobile`, deep-link scheme `trmission://`, OAuth return path `/m/callback`
— all matching the landed P0 server.

## CI lanes (self-managed signing, no EAS)

- **`.github/workflows/mobile-ci.yml`** — ubuntu, PRs touching `apps/mobile/**`/`packages/**`:
  `typecheck` + `lint` + `test` (fast JS gate; the whole-repo CI also covers mobile via turbo).
- **`.github/workflows/mobile-android.yml`** — ubuntu, `release/**` + tags: `expo prebuild` →
  Gradle `bundleRelease` signed via AGP injected-signing properties → `.aab` artifact.
- **`.github/workflows/mobile-ios.yml`** — **macos-latest** (billed ~10x, so release-gated):
  `expo prebuild` → `pod install` → `fastlane ios beta` (match + gym + pilot → TestFlight).

### Required CI secrets / variables

Repo **variables**: `TRM_SERVER_ORIGIN`, `TRM_GOOGLE_WEB_CLIENT_ID`, `TRM_GOOGLE_IOS_CLIENT_ID`,
`TRM_GOOGLE_IOS_URL_SCHEME` (the reversed iOS OAuth client id, `com.googleusercontent.apps.*` — the
google-signin config plugin validates it at every config eval, so `expo prebuild`/`run:android` need
it set or fall back to a format-valid placeholder; see `app.config.ts`).

Android **secrets**: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`.

iOS **secrets**: `MATCH_GIT_URL`, `MATCH_PASSWORD`, `MATCH_GIT_BASIC_AUTHORIZATION` (fastlane match
repo), `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (base64 App Store Connect API key).

Seed the match repo once locally with `fastlane match appstore`; CI consumes it read-only. Confirm
the Xcode scheme/workspace names `expo prebuild` emits before the first iOS build (see the reground
note in `fastlane/Fastfile`).
