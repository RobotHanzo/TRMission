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

## Moderation (`src/store/moderation.ts` — Apple 1.2 / Play UGC)

The account's client-side mute list mirrored locally (hydrated on sign-in/restore, `reset()` on
sign-out; optimistic block/unblock with rollback via `PUT/DELETE /me/blocks/:userId`). Blocking is
display-only: `ChatPanel` filters blocked authors' messages (text AND presets) and
`usePlayerName` masks their UGC display name back to `P{seat+1}` — game state is never touched.
Long-press on a tracker row or chat message opens `PlayerActionSheet` (report with the 7
`REPORT_CATEGORIES` from `@trm/shared` + block/unblock; never for yourself or `bot:` ids — gate
with its `canModerate`). Reports POST `/reports/player` with `gameId`/`roomCode` context read from
`game/activeRoom.ts` (set by GameScreen alongside the push-suppression id; display-only, never
authorization).

## CI lanes (self-managed signing, no EAS)

- **`.github/workflows/mobile-ci.yml`** — ubuntu, PRs touching `apps/mobile/**`/`packages/**`:
  `typecheck` + `lint` + `test` (fast JS gate; the whole-repo CI also covers mobile via turbo).
- **`.github/workflows/mobile-android.yml`** — ubuntu, `release/**` + tags: `expo prebuild` →
  Gradle `bundleRelease` signed via AGP injected-signing properties → `.aab` artifact.
- **`.github/workflows/mobile-ios.yml`** — **macos-latest** (billed ~10x, so release-gated):
  `expo prebuild` → `pod install` → `fastlane ios beta` (match + gym + pilot → TestFlight).
- **`.github/workflows/mobile-ota.yml`** — JS-only OTA publish to the self-hosted
  expo-open-ota server (`eoas publish`; runbook + forced-update interplay in
  `docs/mobile/ota.md`). Native changes are fenced automatically by
  `runtimeVersion: fingerprint` — old binaries just never see the update.

### Required CI secrets / variables

Repo **variables**: `TRM_SERVER_ORIGIN`, `TRM_GOOGLE_WEB_CLIENT_ID`, `TRM_GOOGLE_IOS_CLIENT_ID`,
`TRM_GOOGLE_IOS_URL_SCHEME` (the reversed iOS OAuth client id, `com.googleusercontent.apps.*` — the
google-signin config plugin validates it at every config eval, so `expo prebuild`/`run:android` need
it set or fall back to a format-valid placeholder; see `app.config.ts`).

OTA lane: repo variable `TRM_OTA_URL` (the deployment's full `/manifest` URL) + secret
`EXPO_TOKEN` (Expo robot token — eoas auth/channel mapping only; there is **no** signing
secret in CI, manifests are signed at serve time by the OTA server's mounted key, and
`apps/mobile/certs/keys/` must never be committed).

Android **secrets**: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`.

iOS **secrets**: `MATCH_GIT_URL`, `MATCH_PASSWORD`, `MATCH_GIT_BASIC_AUTHORIZATION` (fastlane match
repo), `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (base64 App Store Connect API key).

Seed the match repo once locally with `fastlane match appstore`; CI consumes it read-only. Confirm
the Xcode scheme/workspace names `expo prebuild` emits before the first iOS build (see the reground
note in `fastlane/Fastfile`).

## Offline vs bots (`src/offline/`)

Serverless mirror of the server's authoritative loop. `localGameSession.ts` runs the real
`@trm/engine` with `@trm/bots` driving bot seats, appends every accepted action to an
event-sourced expo-sqlite log **before** committing (write-ahead, `(game_id, seq)` PK =
double-apply guard), and the UI only ever sees `redactFor(human)` → `viewToSnapshot` into
the sandbox stores — `GameStage` cannot tell online from offline. Resume digest-verifies
the log and **truncates** a corrupt tail (server recovery aborts instead; offline must
never crash into a corrupt save). Version pins: `engineVersion` + registered `contentHash`
refuse cross-version resume. Randomness (seed/gameId) comes from `expo-crypto` in
`seed.ts` ONLY — never inside game logic. Bundled official maps only (custom-map offline
is deferred — docs/TODO.md). Pure core (no RN imports) → jest-testable off-device;
`inMemoryStore.ts` is the port double.

## Tutorial (`src/features/tutorial/`)

The interactive tutorial is fully offline: lessons are scripted scenarios over a REAL local
`@trm/engine` game (`net/sandboxSocket.ts` → engine `reduce` → `redactFor` → `viewToSnapshot`
→ the standard game store → GameStage). `types.ts`, `curriculum.ts`, `focus.ts`, and
`i18n/tutorial.ts` are **byte-identical copies of `apps/web`** (enforced by `parity.spec.ts`)
— the anchor-id strings inside them are simultaneously the web's CSS selectors and this app's
`TutorialTargetRegistry` anchor ids (`targets.tsx`); change them on web first, then re-copy.
HUD spotlights measure ref-registered Views via `measureInWindow` (`useTutorialAnchor`, keep
`collapsable={false}`); city/route spotlights are computed from board geometry projected
through the camera (`boardRects.ts`; `cameraBridge.ts` is the only file that may touch camera
internals). The scrim is a Skia even-odd path (`scrim.ts` + `TutorialSpotlight`). Completion
persists to AsyncStorage (`progress.ts`, key `trm.tutorial.completed.v1`); the Home entry and
the whole flow work with no account and no network. Pure logic tests are vitest `*.spec.ts`;
RN components are jest-expo `*.test.tsx` — keep the globs disjoint.

## Map builder (`src/screens/BuilderScreen.tsx`)

Feature-gated by `user.features` containing `mapBuilder` (`useCanBuild`). The builder itself is
the web app inside a `react-native-webview` (`sharedCookiesEnabled` + `thirdPartyCookiesEnabled`):
the screen fetches a single-use carry code (`api.mobileCarry()`) and points the WebView at
`GET ${SERVER_ORIGIN}/api/v1/auth/mobile-web-handoff?code=…`, which converts it into a normal
Strict-cookie web session and 302s to `/maps` — the one sanctioned native→web session handoff.
Offline/error/loading states have testIDs `builder-offline`/`builder-error`.

## Push (`src/push/`)

`register.ts` owns the token lifecycle — its module path is load-bearing (the session store's
tests mock it): `ensurePushRegistration()` is permission-GATED and **never requests** permission
itself (that only happens from an explicit user gesture in `PushPrompt`/`NotificationsRow`);
`registerDeviceForPush()` adds the `settings.notifications` gate (the session-start hook);
`unregisterDeviceForPush()` runs before logout; `watchTokenRotation()` re-registers on FCM/APNs
rotation. Payload contract is exactly `{kind, gameId, roomCode?}`. `notifications.ts`: the
foreground handler suppresses banners for the game you're looking at (`setActiveGameId`, fed
from `RoomView.gameId` by GameScreen); `navigateForPush` is async because the nav route is
`Game {roomCode}` while `your_turn`/`game_over` carry only `gameId` — it resolves via
`api.getMyRooms()` (vanished room = no-op). `PushPrompt` is the one-shot contextual card at
game-over (`pushPromptSeen`).

**Expo Go gotcha:** never `import * as Notifications from 'expo-notifications'` directly —
`expo-notifications`'s own auto-registration side effect calls `addPushTokenListener` at IMPORT
time, which throws under Expo Go on Android (SDK 53 dropped remote push from Expo Go). All 4
call sites (`register.ts`, `notifications.ts`, `PushPrompt.tsx`, `NotificationsRow.tsx`) import
the lazy, `isRunningInExpoGo()`-gated `Notifications` from `push/expoNotifications.ts` instead —
`null` under Expo Go (push no-ops), the real module in dev/production builds. Same pattern in
`auth/googleSigninModule.ts` for `@react-native-google-signin/google-signin` (a third-party
native module never bundled in Expo Go at all, unlike `expo-*` packages). Both are backed by
`apps/mobile/__mocks__/expo.js`, which forces `isRunningInExpoGo()` false under jest (jest-expo's
own native-module automock otherwise reports `ExpoGo` present) while delegating every other
export to the real `expo` package — don't narrow that mock further without checking who else
imports from `expo` (e.g. `expo-sqlite` pulls `requireNativeModule` through it).

## Haptics (`src/game/haptics.ts` + `useHaptics.ts`)

`cuesForEvents` is a pure event→cue map (routeClaimed / tunnelRevealed / ticketCompleted /
gameEnded) so it stays vitest-testable; `useHaptics` fires expo-haptics behind
`settings.haptics`, mounted in GameStage next to the sound driver with the same
`lastBatch.seq` once-per-batch idiom.

## Settings (`src/store/settings.ts` + `src/screens/SettingsScreen.tsx`)

Zustand persist key `trm-settings` (haptics **on**, notifications **off**, `pushPromptSeen`
false by default). `NotificationsRow` toggle ON = OS permission request (permanently denied ⇒
alert → `Linking.openSettings()`) then `ensurePushRegistration`; OFF = unregister the device.
Account deletion (hidden for guests, store-compliance requirement): two-step confirm →
`performAccountDeletion` (`src/account/deleteAccount.ts`) — fresh SIWA authorization code when
available (cancel proceeds without), push unregister, `DELETE /auth/me`, local session clear.

## OTA updates (expo-updates + self-hosted expo-open-ota)

`app.config.ts` pins `runtimeVersion: { policy: 'fingerprint' }` and code-signing against the
committed `certs/certificate.pem` (`fallbackToCacheTimeout: 0` — stale-while-revalidate; the
forced-update gate `GET /version/mobile` is independent and still runs every boot).
`updates.url` comes from `TRM_OTA_URL` (default: the local compose `ota` service,
`http://localhost:3005/manifest`); the channel is baked at build time via the
`expo-channel-name` request header (`TRM_OTA_CHANNEL`, default `production`). Full contract,
runbook, rollback, and fallbacks: `docs/mobile/ota.md`. The private key in `certs/keys/` is
gitignored and must never be committed.

## Orientation & layout tiers (`src/app/useOrientationPolicy.ts`)

Phones (smallest window side < 600dp) lock PORTRAIT_UP; tablets stay unlocked — and Android 16+
ignores lock requests on ≥600dp anyway, so every screen must survive free rotation/resize.
`stageTier` (compact < 700dp ≤ two-pane < 1000dp ≤ three-pane) is measured from live window
width, never device type.
