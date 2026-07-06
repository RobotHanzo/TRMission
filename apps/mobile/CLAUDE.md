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

Repo **variables**: `TRM_SERVER_ORIGIN`, `TRM_GOOGLE_WEB_CLIENT_ID`, `TRM_GOOGLE_IOS_CLIENT_ID`.

Android **secrets**: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`.

iOS **secrets**: `MATCH_GIT_URL`, `MATCH_PASSWORD`, `MATCH_GIT_BASIC_AUTHORIZATION` (fastlane match
repo), `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (base64 App Store Connect API key).

Seed the match repo once locally with `fastlane match appstore`; CI consumes it read-only. Confirm
the Xcode scheme/workspace names `expo prebuild` emits before the first iOS build (see the reground
note in `fastlane/Fastfile`).
