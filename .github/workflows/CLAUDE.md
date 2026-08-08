# CI workflows (`.github/workflows/`)

`ci.yml` (whole-repo turbo gates) and `docker-build.yml` cover the web/server stack. The mobile
lanes below are self-managed signing with **no EAS** — app context: `apps/mobile/CLAUDE.md`.
Dependency bumps land through `../dependabot.yml` (see **Dependency updates** at the bottom).

## Mobile lanes

- **`mobile-ci.yml`** — ubuntu, PRs touching `apps/mobile/**`/`packages/**`: `typecheck` + `lint` +
  `test` (fast JS gate; the whole-repo CI also covers mobile via turbo), plus
  `scripts/fingerprintEnv.js --audit` (the OTA runtimeVersion env contract — see **Required mobile
  secrets / variables**).
- **`mobile-android.yml`** — ubuntu, `release/**` + tags: derives `BUILD_NUMBER` from a
  `v<semver>+<build>` tag (branch pushes fall back to 1) → `expo prebuild` → Gradle
  `bundleRelease` signed via AGP injected-signing properties → `.aab` artifact → on a real tag only,
  `fastlane android internal` publishes to Play's **internal testing track** (never production —
  promote locally with `fastlane android promote`). One-time Play Console + service-account setup:
  `docs/release/play-console-setup.md`. Native-build speed stack: **RNRepo** prebuilt artifacts
  (`@rnrepo/expo-config-plugin`) replace source compilation of the covered autolinked modules
  (Skia/Reanimated/Worklets/gesture-handler/screens; `expo-modules-core` still builds from source on
  RN 0.86), **ccache** (`CCACHE_COMPILERCHECK=content` — the default `mtime` missed everything because
  CNG regenerates `android/` each run) covers the fallback compiles, and **`gradle/actions/setup-gradle`**'s
  build cache the Kotlin/Java/dex tasks; `lintVitalRelease` is skipped, and a daily scheduled
  warm-up on main keeps those caches alive between infrequent release runs (see **Cache scoping**).
- **`mobile-ios.yml`** — **macos-26** (pinned: the Liquid Glass `.icon` bundle needs Xcode 26's
  actool; release-gated): same tag-derived `BUILD_NUMBER` → `expo prebuild` → `pod install` →
  `fastlane ios beta` (setup_ci keychain → match readonly → `update_code_signing_settings` flips
  the app target to manual signing — prebuild emits an Automatic/no-team project — → gym). Every
  run uploads the `.ipa` as a workflow artifact; `pilot` → TestFlight only on a real
  `v<semver>+<build>` tag (`upload:true`), mirroring Android's Play gate — non-tag runs all carry
  BUILD_NUMBER=1, which TestFlight would reject as a duplicate. Native-build speed stack: **RN 0.86
  official prebuilt binaries** (`RCT_USE_PREBUILT_RNCORE=1` + `RCT_USE_RN_DEP=1` at `pod install` —
  Meta-built core and folly/glog/boost tarballs from Maven Central, auto-reverting to source when
  absent; `RCT_SYMBOLICATE_PREBUILT_FRAMEWORKS` stays **unset** — it nests each dSYM inside
  `React.framework`, which App Store Connect rejects (ITMS 90171), and a build-time re-extract
  undoes any later cleanup, so React core symbolication is off until upstream RN moves the dSYM
  beside the framework), **ccache** covers what still compiles from source (enabled via `USE_CCACHE=1` on
  `pod install` — deliberately an env var, NOT expo-build-properties' `ios.ccacheEnabled`, which
  would shift the OTA runtimeVersion fingerprint; same `CCACHE_COMPILERCHECK=content` lesson as
  Android plus the Xcode sloppiness/depend-mode set for clang modules, and the `CCACHE_DIR` +
  `CCACHE_BINARY` pins that RN's `ccache-clang.sh` wrapper needs — see **Cache scoping**), the Pods
  cache is keyed on Podfile+yarn.lock, and the same daily scheduled warm-up as Android keeps the
  caches alive (free — the repo is public).
- **`mobile-ios-certs.yml`** — workflow_dispatch-only macOS job running `fastlane ios certs` (match
  **read-write**, ASC-API-key auth): seeds/rotates the Distribution cert + App Store profiles (one
  per bundle id in the Matchfile: the app + the Live Activity widget extension) in the private match
  repo. No maintainer owns a Mac — this workflow is the only place signing assets are ever
  generated. Dispatch with `force: true` after changing App ID capabilities or adding a target;
  re-run before certs expire (~1 year). `match` never creates App IDs, so the lane creates the
  widget's capability-less one itself via the ASC API (`ensure_bundle_id`) — the app's own App ID
  stays manual, since its capabilities have to be enabled in the portal anyway.
- **`mobile-ota.yml`** — JS-only OTA publish to the self-hosted expo-open-ota server
  (`eoas publish`; runbook + forced-update interplay in `docs/mobile/ota.md`). Native changes are
  fenced automatically by `runtimeVersion: fingerprint` — old binaries just never see the update.
  Publish speed stack (no caches — see **Cache scoping**): the export is pinned to **android+ios**
  via a `--packageRunner` shim, because `platforms` is auto-derived from the installed
  `react-native-web` and the resulting web bundle is discarded by `createMetadataJson` after
  bundling — free to skip, and unlike editing the app config it doesn't move the fingerprint;
  `eoas` is npx-prefetched in the background of the runtime-version step; and the typecheck gate is
  scoped to the packages that can reach the bundle (`!@trm/{web,admin,server}` — negative filters,
  since `src/offline` imports `@trm/bots` without declaring it).

## Cache scoping (issue #46)

Two properties of GitHub's cache decide whether any of the caches above ever pay off, and both bit
this repo hard enough to hold ccache at a **0% hit rate on every mobile build**:

- **Caches are ref-scoped.** A run can read only its own ref's caches plus the default branch's.
  The mobile lanes fire on `v<semver>+<build>` **tags** — a fresh, write-once ref every release —
  so a cache saved by one release build is unreadable by the next. **Only the daily main-branch
  warm-up leaves an entry that release builds can restore.** That is why the schedules exist; they
  are not a nice-to-have. Both lanes therefore pass `save: ${{ github.ref_type != 'tag' }}`: a
  tag-scoped save is dead on arrival and only crowds the budget below.
- **One 10GB budget, shared by every workflow, evicted by LRU.** `docker-build.yml` had grown to
  5.9GB of `type=gha` buildkit blobs, putting the repo permanently over the limit. Those blobs are
  re-read on every main push and stay warm; ccache (~280MB, touched only on release days) was
  always the coldest entry and was evicted within hours of each warm-up. The docker layer cache now
  goes to GHCR (`type=registry`) instead, taking the repo back under the limit. **Before adding any
  large new cache, check `gh api repos/:owner/:repo/actions/cache/usage` — going over the limit
  doesn't fail anything loudly, it just silently starves the caches that are used least often.**

Debugging a bad hit rate: read the ccache-action's **"Restore cache"** group first. `No cache found`
means there was nothing to hit and the `ccache -s` numbers are just reporting that faithfully — go
look at scoping and eviction, not at `CCACHE_*` tuning. `Cacheable calls: 0` is the _other_ failure
and means the compiler never reached ccache at all: on iOS that was RN's `ccache-clang.sh` wrapper,
which force-sets `CCACHE_CONFIGPATH` to its own bundled conf (no `cache_dir`, so objects land
outside the directory the action saves) and runs `exec $CCACHE_BINARY clang "$@"`, silently
degrading to bare clang when that variable is empty. `CCACHE_DIR` and `CCACHE_BINARY` in the job env
outrank both.

## Required mobile secrets / variables

Repo **variables**: `TRM_SERVER_ORIGIN`, `TRM_GOOGLE_WEB_CLIENT_ID`, `TRM_GOOGLE_IOS_CLIENT_ID`,
`TRM_GOOGLE_IOS_URL_SCHEME` (the reversed iOS OAuth client id, `com.googleusercontent.apps.*` — the
google-signin config plugin validates it at every config eval, so `expo prebuild`/`run:android` need
it set or fall back to a format-valid placeholder; see `apps/mobile/app.config.ts`).
There is deliberately **no `TRM_GOOGLE_ANDROID_CLIENT_ID`** — Android Google Sign-In is keyed on the
app's (package name, signing-cert SHA-1) matched against an Android OAuth client in the Cloud
console, so a lane can look fully configured and still fail with `DEVELOPER_ERROR` on device.
Registering the **Play app-signing** key's SHA-1 (not the upload key's) is the fix:
`docs/release/play-console-setup.md` §4.

**Fingerprint-input env vars (issue #62).** `TRM_GOOGLE_IOS_URL_SCHEME`, `TRM_OTA_APP_ID`,
`TRM_OTA_CHANNEL`, `TRM_OTA_URL`, `TRM_SERVER_ORIGIN` reach the OTA `runtimeVersion` fingerprint, so
**every env block that evaluates `app.config.ts` for a shipped artifact must set all five** — both
store lanes' prebuild AND build steps, and both of the OTA lane's steps. The build step is the
load-bearing one: expo-updates bakes the runtime version during Gradle assemble / the gym build,
from the config as re-evaluated there. `TRM_GOOGLE_IOS_URL_SCHEME` is the trap — its native effect
is iOS-only, but it is a config-PLUGIN PROP and `plugins` is platform-agnostic, so it is hashed for
Android too; `mobile-android.yml` never set it, so no Android device ever received an OTA. `apps/mobile/scripts/fingerprintEnv.js --assert` (in every one of those blocks) fails a lane
that forgets one, and `--audit` (mobile-ci.yml) fails a PR that makes a new env var reach the
fingerprint without adding it to the list. Full write-up: `docs/mobile/ota.md`.

OTA lane: repo variables `TRM_OTA_URL` (the deployment's full `/manifest` URL) and `TRM_OTA_APP_ID`
(the Expo project id, baked as the `expo-app-id` header — expo-open-ota v3 is multi-app) + secret
`EXPO_TOKEN` (Expo robot token — eoas auth/channel mapping only; there is **no** signing secret in
CI, manifests are signed at serve time by the OTA server's mounted key, and
`apps/mobile/certs/keys/` must never be committed). **Both variables are also set by the store
lanes**: `updates.url` and `updates.requestHeaders` are runtimeVersion fingerprint inputs, so a
binary built without them targets a different runtime version than the updates published with them.
`BUILD_NUMBER`/`APP_VERSION` are the deliberate exception — the store lanes stamp them from the
release tag and the OTA lane has none, so `apps/mobile/fingerprint.config.js` skips the version axes
(and `extra`) out of the fingerprint entirely. Without that skip no publish could ever match a
shipped binary, which is exactly what issue #55 was (docs/mobile/ota.md).

Android **secrets**: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD` (signing), `PLAY_JSON_KEY_BASE64` (base64 Play service-account JSON —
Play Developer API access for `fastlane android internal`; provisioning steps in
`docs/release/play-console-setup.md`).

iOS **secrets**: `MATCH_GIT_URL`, `MATCH_PASSWORD`, `MATCH_GIT_BASIC_AUTHORIZATION` (fastlane match
repo — the PAT needs write access, the certs workflow pushes), `ASC_KEY_ID`, `ASC_ISSUER_ID`,
`ASC_KEY_P8` (base64 App Store Connect API key). Plus repo **variable** `APPLE_TEAM_ID` (public in
the AASA file anyway; the beta lane stamps it into the prebuilt project as `DEVELOPMENT_TEAM`).

Sentry (issue #44), **all optional** — an unconfigured repo builds exactly as today. Full setup
walkthrough: `docs/release/sentry-setup.md`. Repo **variables**: the `TRM_SENTRY_*` set (`_DSN`,
`_ENVIRONMENT`, `_TRACES_SAMPLE_RATE`, `_REPLAY_SAMPLE_RATE`, `_REPLAY_ERROR_SAMPLE_RATE`), which
land in `extra` (app runtime config), plus `SENTRY_ORG` and `SENTRY_MOBILE_PROJECT`; secret
`SENTRY_AUTH_TOKEN` (source-map/debug-symbol upload — with it unset the lanes export
`SENTRY_DISABLE_AUTO_UPLOAD=true` so the injected upload phase can't fail the build). Like the
Google client ids, **every `TRM_SENTRY_*` var must be set on the OTA lane too**: an applied
update's manifest replaces the binary's `extra`, so publishing without them would strip the DSN off
every device that takes the update. The web/admin images take the equivalent values as Docker build
args in `docker-build.yml`, with the auth token passed as a BuildKit **secret** rather than a build
arg — a build arg is baked into the stage's layer metadata, which now ships to a public GHCR
buildcache tag.

Seed the match repo by dispatching `mobile-ios-certs` once the App ID + ASC key exist
(`docs/release/app-store-connect-setup.md` Steps 2–6); the build lane consumes it read-only. The
Xcode workspace/scheme names (`TRMission`) are verified against prebuild's rename logic and
asserted in-workflow right after `pod install`.

## Dependency updates (`../dependabot.yml`)

Four ecosystems, all weekly on Monday: **npm** (one entry at `/` — Dependabot resolves the whole
Yarn 4 workspace from the root lockfile), **github-actions**, **docker** (both Dockerfiles), and
**docker-compose** (root compose images). Two things to know before editing it:

- **The groups are load-bearing, not noise reduction.** `react` (exact-pinned and identical across
  web/admin/mobile), `expo-sdk` (the SDK 57 compat matrix — an individual bump also shifts the OTA
  runtimeVersion fingerprint), and `vite-vitest` (vite 8 ⇄ vitest 4 ⇄ plugin-react 6) are only
  correct as units. Majors are ignored on `react*`, `expo`, `react-native` (whose _minor_ is a
  breaking release), and the `node`/`mongo` images; those are hand-driven migrations. Groups match
  top-down, first hit wins.
- **The `github-actions` entry must list every directory holding action files.** `/` only covers
  `.github/workflows/`; `.github/actions/*` is listed separately for the composite action. Add a
  directory when you add one, or its `uses:` pins go stale silently.

Dependabot-triggered runs get **no Actions secrets** (Dependabot has its own secret store) and a
read-only `GITHUB_TOKEN` unless a workflow's own `permissions:` block grants more — `ci.yml`
declares `checks: write` for the junit reporter. Neither PR gate (`ci.yml`, `mobile-ci.yml`) reads a
secret, so keep it that way or Dependabot PRs start failing on a gate that has nothing to do with
the bump.
