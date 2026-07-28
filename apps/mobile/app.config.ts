import { withDangerousMod, withGradleProperties } from '@expo/config-plugins';
import type { ExpoConfig } from 'expo/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Build number is the forced-update gate axis (compared against GET /version/mobile.minBuild) AND
// the native versionCode/CFBundleVersion (docs/release/mobile-versioning.md). The release workflows
// derive it from the release tag (`v<semver>+<build>`) and inject it via this env var at
// `expo prebuild` time; local/dev builds fall back to 1 and are never shipped.
//
// Only the NATIVE stamping matters. The gate reads the build number back off the installed binary
// via expo-application, not off `extra`/`expoConfig` — an applied OTA update replaces those with
// whatever the publish lane evaluated (which has no release tag, so: this fallback). See
// src/config.ts and docs/mobile/ota.md. Skipped from the runtimeVersion fingerprint by
// fingerprint.config.js, so a version bump alone never fences an update off.
const BUILD_NUMBER = Number(process.env.BUILD_NUMBER ?? 1);

// Marketing version (CFBundleShortVersionString / Android versionName) — an independent semver
// axis from BUILD_NUMBER above (docs/release/mobile-versioning.md). The release workflows derive
// it from the release tag's semver prefix (`v<semver>+<build>`) and inject it via this env var at
// `expo prebuild` time; local/dev builds fall back to the placeholder below and are never shipped.
// `||` (not `??`): an unset repo variable reaches CI as `''`, not undefined, same gotcha as
// serverOrigin below — an empty string would sail past `??` and ship as the literal version.
const APP_VERSION = process.env.APP_VERSION || '0.1.0';

// The commit this binary was built from (Settings → About). `actions/checkout` always leaves a
// `.git` dir in place (even on a shallow clone HEAD is still resolvable), so this needs no CI
// plumbing — unlike BUILD_NUMBER/APP_VERSION above it isn't an input the release workflows have to
// derive and pass through, it falls out of whatever commit is checked out. Never throws: a
// tarball/archive checkout with no `.git` (or no git binary) just ships 'dev', same fallback as
// apps/web/apps/admin's VITE_COMMIT_HASH.
const GIT_COMMIT = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
})();

// The google-signin config plugin (without-Firebase mode) VALIDATES `iosUrlScheme` at every config
// eval — for `expo run:android`/`prebuild` too, not just iOS — and rejects anything not prefixed
// `com.googleusercontent.apps.`. That's the reversed iOS OAuth client id (shown as its own value in
// the Google console). Provisioned at store-setup (P6) via TRM_GOOGLE_IOS_URL_SCHEME; until then a
// format-valid placeholder lets native builds run — consistent with the Google button no-op'ing
// until real client ids land (see `extra` below). `||` (not `??`): an unset repo variable reaches
// CI as `''`, not undefined (`${{ vars.TRM_GOOGLE_IOS_URL_SCHEME }}`), same gotcha as serverOrigin
// below — an empty string would sail past `??` and fail the plugin's validation.
const googleIosUrlScheme =
  process.env.TRM_GOOGLE_IOS_URL_SCHEME || 'com.googleusercontent.apps.placeholder';

// One source for the production origin: the deep-link hosts (associated domains / App Links) and
// the app's API base derive from the same env var so they can never drift apart. `||` (not `??`):
// an unset repo variable reaches CI as `''`, not undefined (`${{ vars.TRM_SERVER_ORIGIN }}`), and
// an empty string is never a legitimate origin.
const serverOrigin = process.env.TRM_SERVER_ORIGIN || 'https://trmission.robothanzo.dev';
const serverHost = new URL(serverOrigin).hostname;

// The OTA server's app identity (expo-open-ota v3 is multi-app; the id is the Expo project id, the
// same value as the server's own EXPO_APP_ID env). Sent as the `expo-app-id` request header and
// required by `eoas publish` to resolve the app it is publishing to.
//
// Deliberately OMITTED when unset rather than defaulted to '': an empty header is not the same as no
// header — the server serves a request with no app id by falling back to its EXPO_APP_ID (that is the
// pre-v3 "v1 client" shape, which is exactly what a local dev build wants), while a blank one is an
// invalid app id. `updates.requestHeaders` IS a runtimeVersion fingerprint input (the whole
// `updates` block is; fingerprint.config.js only skips the version axes and `extra`), so a build
// with this set and one without it target different
// runtime versions — CI must set it for BOTH the store lanes and the OTA publish, or a published
// update becomes invisible to the binary it was meant for. See docs/mobile/ota.md.
const otaAppId = process.env.TRM_OTA_APP_ID || undefined;

// Google AdMob (issue #50) — checked-in static config, the mobile twin of apps/web's
// `config/adsense.ts`. NOT secret: the app id sits in the Android manifest / Info.plist and every
// ad-unit id is compiled into the binary, so an env var would protect nothing.
//
// Env vars would actively HURT here. The app ids go to the react-native-google-mobile-ads config
// plugin, and **plugin props feed the OTA runtimeVersion fingerprint** — env-derived ids would make
// the fingerprint depend on which CI lane evaluated this file, and a store binary would stop
// matching its own OTA updates (the issue-#55 failure mode, docs/mobile/ota.md). Literals are
// identical on every lane by construction. The runtime reads the unit ids back off `extra`
// (src/config.ts → src/ads/) — that half is fingerprint-skipped, but an applied update still
// replaces it, which is the separate lockstep rule TRM_SENTRY_* and the Google client ids follow.
//
// To turn ads off, flip `enabled`: it is the master switch, so the ids can stay checked in.
const ADMOB = {
  /** Master switch. False ⇒ no ad renders, nothing preloads, the SDK is never initialised. */
  enabled: true,
  // The AdMob *app* ids (`ca-app-pub-…~…`, tilde). The native SDK CRASHES at startup without a
  // syntactically valid one — before the real app was registered these carried Google's documented
  // sample app ids for exactly that reason.
  androidAppId: 'ca-app-pub-6497728947722029~2041113047',
  iosAppId: 'ca-app-pub-6497728947722029~7046027715',
  // Ad-*unit* ids (`ca-app-pub-…/…`, slash), '' ⇒ that placement renders nothing on that platform.
  //
  // Per-platform because an ad unit belongs to ONE AdMob app, and the two apps above are separate
  // AdMob apps: an Android unit id simply does not exist inside the iOS app, so requesting it there
  // never fills. Create each placement twice in the console — once under the Android app, once under
  // the iOS app — and paste both. `src/ads/ads.ts` picks by `Platform.OS`.
  //
  // `__DEV__` builds ignore all of these and use Google's TestIds, so no developer can click a live ad.
  units: {
    /** Anchored adaptive banner docked on the browse surfaces (Home / Encyclopedia contents /
     *  Leaderboard / History). One unit per platform covers all four — same shape, and they are
     *  never on screen together. UNIT TYPE: Banner. */
    banner: {
      android: 'ca-app-pub-6497728947722029/2512488973',
      ios: 'ca-app-pub-6497728947722029/3633998958',
    },
    /** Shown on leaving a FINISHED offline vs-bots game (capped, src/ads/interstitial.ts).
     *  UNIT TYPE: Interstitial. */
    offlineGameEnd: {
      android: 'ca-app-pub-6497728947722029/1805766175',
      ios: 'ca-app-pub-6497728947722029/3554107902',
    },
  },
};

// SKAdNetwork ids for the networks Google may serve through
// (https://developers.google.com/admob/ios/3p-skadnetworks). A publisher lists these in Info.plist
// so advertisers on those networks can attribute installs driven by ads shown in THIS app — which
// is what makes their demand biddable on our inventory. Purely additive: an id for a network we
// never serve is inert. Unrelated to NSPrivacyTrackingDomains (see the privacy manifest below).
const ADMOB_SKADNETWORK_IDS = [
  'cstr6suwn9.skadnetwork', // Google's own
  '4fzdc2evr5.skadnetwork',
  '2fnua5tdw4.skadnetwork',
  'ydx93a7ass.skadnetwork',
  'p78axxw29g.skadnetwork',
  'v72qych5uu.skadnetwork',
  'ludvb6z3bs.skadnetwork',
  'cp8zw746q7.skadnetwork',
  '3sh42y64q3.skadnetwork',
  'c6k4g5qg8m.skadnetwork',
  's39g8k73mm.skadnetwork',
  'wg4vff78zm.skadnetwork',
  '3qy4746246.skadnetwork',
  'f38h382jlk.skadnetwork',
  'hs6bdukanm.skadnetwork',
  'mlmmfzh3r3.skadnetwork',
  'v4nxqhlyqp.skadnetwork',
  'wzmmz9fp6w.skadnetwork',
  'su67r6k2v3.skadnetwork',
  'yclnxrl5pm.skadnetwork',
  't38b2kh725.skadnetwork',
  '7ug5zh24hu.skadnetwork',
  'gta9lk7p23.skadnetwork',
  'vutu7akeur.skadnetwork',
  'y5ghdn5j9k.skadnetwork',
  'v9wttpbfk9.skadnetwork',
  'n38lu8286q.skadnetwork',
  '47vhws6wlr.skadnetwork',
  'kbd757ywx3.skadnetwork',
  '9t245vhmpl.skadnetwork',
  'a2p9lx4jpn.skadnetwork',
  '22mmun2rn5.skadnetwork',
  '44jx6755aq.skadnetwork',
  'k674qkevps.skadnetwork',
  '4468km3ulz.skadnetwork',
  '2u9pt9hc89.skadnetwork',
  '8s468mfl3y.skadnetwork',
  'klf5c3l5u5.skadnetwork',
  'ppxm28t8ap.skadnetwork',
  'kbmxgpxpgc.skadnetwork',
  'uw77j35x4d.skadnetwork',
  '578prtvx9j.skadnetwork',
  '4dzt52r2t5.skadnetwork',
  'tl55sbb4fm.skadnetwork',
  'c3frkrj4fj.skadnetwork',
  'e5fvkxwrpn.skadnetwork',
  '8c4e2ghe7u.skadnetwork',
  '3rd42ekr43.skadnetwork',
  '97r2b46745.skadnetwork',
  '3qcr597p9d.skadnetwork',
];

const config: ExpoConfig = {
  name: 'TRMission',
  slug: 'trmission',
  scheme: 'trmission', // trmission:// OAuth deep-link fallback (P0 accepts it)
  version: APP_VERSION,
  orientation: 'default', // tablets unlock; phone default is portrait (enforced per-screen in P2)
  // The shared TRMission rail-ticket mark — the same logo as the web favicon
  // (apps/web/public/icon.svg), ported to the native sizes/masks by scripts/gen-brand-assets.js.
  // Full-bleed square: the OS applies its own mask. Also the Android legacy icon + web favicon
  // fallback (ios.icon below overrides this with the Liquid Glass `.icon` bundle for iOS).
  icon: './assets/icon.png',
  // Chrome theming follows the OS + the in-app theme setting (theme/useTheme.ts).
  userInterfaceStyle: 'automatic',
  // New Architecture is the default (and only) mode in RN 0.85 / SDK 56 — no flag needed.
  ios: {
    // iOS 26 Liquid Glass icon: a hand-authored Icon Composer `.icon` bundle (icon.json + a
    // transparent PNG ticket layer, written by scripts/gen-brand-assets.js — see its header).
    // withIosIcons copies the bundle into the Xcode project and points
    // ASSETCATALOG_COMPILER_APPICON_NAME at it; Xcode 26's actool (mobile-ios.yml pins macos-26)
    // renders true glass for iOS 26 — no more system-frosted legacy PNG — plus flattened fallbacks
    // for older iOS, with the system's standard dark-grey tile in dark mode ('system-dark' fill,
    // matching the built-in apps). If actool ever rejects the bundle, revert to the
    // still-generated flat trio:
    //   icon: { light: './assets/icon.png', dark: './assets/icon-dark.png', tinted: './assets/icon-tinted.png' }
    icon: './assets/TRMission.icon',
    bundleIdentifier: 'dev.robothanzo.trmission',
    buildNumber: String(BUILD_NUMBER),
    supportsTablet: true, // iPad; requireFullScreen deliberately unset (iPadOS 26 ignores it)
    associatedDomains: [`applinks:${serverHost}`],
    config: {
      // Standard TLS only (exempt) — answers App Store Connect's export-compliance question so
      // TestFlight/App Store submissions don't stall on the manual prompt.
      usesNonExemptEncryption: false,
    },
    infoPlist: {
      // Live Activities (issue #43): the in-game turn card on the lock screen + Dynamic Island.
      // ActivityKit refuses to start an activity without the first key; the second lifts the
      // update budget for an app whose activity legitimately changes on every turn (the server
      // still only pushes to players whose socket is gone — see PushService.updateLiveActivities).
      // The widget extension that renders them is injected by plugins/withLiveActivity.js.
      NSSupportsLiveActivities: true,
      NSSupportsLiveActivitiesFrequentUpdates: true,
    },
    // Apple privacy manifest (ITMS-91053): the required-reason APIs this app's dependency graph
    // touches — AsyncStorage/UserDefaults (CA92.1), file timestamps (expo-updates/sqlite/
    // file-system, C617.1), free disk space (E174.1), system boot time (uptime clocks, 35F9.1).
    // App Store Connect's App Privacy questionnaire (accounts, UGC, push tokens, advertising) is
    // filled separately per docs/release/*.
    // Sentry (issue #44) collects crash, performance and other diagnostic data — declared below.
    // Those three are app-functionality-only and NOT linked to identity (the only identifier
    // attached is the server-minted account id, and `sendDefaultPii: false` keeps IPs off events).
    //
    // AdMob (issue #50) is why the device id is declared below: personalized ads use the IDFA
    // across apps, which is tracking as ATT defines it, so the app requests ATT (see
    // `userTrackingUsageDescription` on the plugin below) and declares the device id it collects,
    // flagged NSPrivacyCollectedDataTypeTracking.
    //
    // The top-level NSPrivacyTracking flag nevertheless stays FALSE, with an empty
    // NSPrivacyTrackingDomains — do not "fix" this pair, they are one decision:
    //   * Apple rejects any build whose NSPrivacyTracking is true unless NSPrivacyTrackingDomains
    //     names at least one domain (ITMS-91064; it took down 0.2.18 build 18, which shipped
    //     true + []). So true is not a free extra disclosure — it forces a domain list.
    //   * iOS BLOCKS connections to every listed domain whenever ATT is not granted. Listing
    //     Google's ad domains would kill ad fill for the ATT-denied majority, not just
    //     personalization — a revenue bug wearing diligence as a costume.
    //   * There is no honest list to give: GoogleMobileAds.framework/PrivacyInfo.xcprivacy (13.x)
    //     declares DeviceID with …TypeTracking=true and purpose ThirdPartyAdvertising, and sets
    //     NO NSPrivacyTracking key and NO NSPrivacyTrackingDomains key at all. Xcode merges the
    //     SDK's manifest into the app's privacy report, so mirroring its shape is what keeps our
    //     declaration in step with the SDK that actually does the collecting.
    // The IDFA-for-tracking disclosure therefore lives where Apple reads it for the store listing:
    // the collected-data-type entry below plus App Store Connect's App Privacy questionnaire
    // (answered "yes, used for tracking" — docs/release/app-store-connect-setup.md).
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        {
          // The advertising identifier the Google Mobile Ads SDK reads once ATT is granted.
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: true,
          NSPrivacyCollectedDataTypePurposes: [
            'NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising',
          ],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePerformanceData',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherDiagnosticData',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
      ],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
      ],
    },
  },
  android: {
    package: 'dev.robothanzo.trmission',
    versionCode: BUILD_NUMBER,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      // Android 13+ themed icons tint this white-alpha variant to the wallpaper palette.
      monochromeImage: './assets/adaptive-icon-monochrome.png',
      backgroundColor: '#E55509', // EMU orange — the tile behind the white ticket foreground
    },
    intentFilters: [
      {
        // App Link for shared room URLs (e.g. https://trmission.robothanzo.dev/room/ABC123)
        // so tapping one opens straight into the app instead of Chrome. OAuth does NOT need an
        // entry here: the mobile OAuth round trip completes via a trmission:// custom-scheme
        // redirect (see AuthConfig.mobileCallback on the server), never this https App Link.
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: serverHost, pathPrefix: '/room' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    // `com.google.android.gms.permission.AD_ID` used to be blocked here ("no ads/analytics
    // anywhere"). Issue #50 reverses that: the Google Mobile Ads SDK declares the permission and
    // needs it to serve PERSONALIZED ads on Android 13+ (blocked ⇒ the advertising id reads back
    // as all-zeroes and every request degrades to non-personalized). Play's Data-safety form
    // declares the advertising id accordingly — docs/release/play-console-setup.md.
  },
  web: {
    // Desktop-browser harness so agents (Playwright) can exercise the mobile UI — not a shipped
    // surface. `yarn workspace @trm/mobile web` serves it on :8081; see CLAUDE.md "Web harness".
    bundler: 'metro',
    output: 'single', // SPA fallback so deep links (e.g. /room/CODE) resolve client-side
    favicon: './assets/icon.png',
  },
  updates: {
    // Self-hosted expo-open-ota manifest endpoint (docs/mobile/ota.md). The origin is a
    // deploy-time repo variable so dev builds can point at the local compose container.
    // NEVER an EAS URL — no EAS anywhere in this project. `||` (not `??`) for the same reason
    // as serverOrigin above: an unset repo variable reaches CI as '', which `??` would bake in
    // as a broken updates.url.
    url: process.env.TRM_OTA_URL || 'http://localhost:3005/manifest',
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    // Launch waits 0ms for the check: stale-while-revalidate. A downloaded update applies on
    // the NEXT cold start. The forced-update gate (GET /version/mobile) still runs every boot.
    fallbackToCacheTimeout: 0,
    // Installed apps only accept bundles signed by our certificate; expo-open-ota signs at
    // SERVE time with the private key mounted on the server (never in CI, never committed).
    codeSigningCertificate: './certs/certificate.pem',
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
    // expo-open-ota resolves the update branch from this channel header (production|preview), and
    // v3 resolves WHICH APP from expo-app-id (see otaAppId above for why it is spread, not defaulted).
    requestHeaders: {
      'expo-channel-name': process.env.TRM_OTA_CHANNEL ?? 'production',
      ...(otaAppId ? { 'expo-app-id': otaAppId } : {}),
    },
  },
  // An OTA can never land on an incompatible native build: the fingerprint hashes the whole
  // native surface (modules, SDK, config plugins), so mismatched binaries ignore the update.
  runtimeVersion: { policy: 'fingerprint' },
  plugins: [
    'expo-secure-store',
    'expo-apple-authentication',
    // Native bottom tab bar (Home/Encyclopedia/Leaderboard/Settings) — a real UITabBarController
    // on iOS (Liquid Glass on iOS 26) / Material3 tab bar on Android, not a JS-rendered lookalike.
    'react-native-bottom-tabs',
    ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }],
    // Brand-coloured status-bar tint for Android notifications (a dedicated white-on-transparent
    // small icon is a designer TODO; until then the default icon is at least tinted).
    ['expo-notifications', { color: '#E55509' }],
    // Android 16 = target API 36, mandatory for Play updates from 2026-08-31 (P5 Task 8 pin).
    ['expo-build-properties', { android: { targetSdkVersion: 36, compileSdkVersion: 36 } }],
    [
      'expo-splash-screen',
      {
        // Mark + bilingual wordmark lockup; App.tsx holds the splash until the boot chain
        // (forced-update check → prefs hydrate → session restore) finishes.
        image: './assets/splash-icon.png',
        imageWidth: 360,
        backgroundColor: '#f6f1e7', // warm paper
        dark: {
          image: './assets/splash-icon-dark.png',
          backgroundColor: '#1a1c1f', // DARK_TOKENS.paper
        },
      },
    ],
    // Error/performance monitoring (issue #44). Deliberately passed NO props: the plugin falls
    // back to the SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN environment variables at BUILD
    // time, which keeps the plugin entry — and therefore the OTA runtimeVersion fingerprint —
    // identical whether or not a Sentry account is configured. Passing organization/project here
    // would stamp them into the config and make the fingerprint depend on the operator's env.
    // NOTE: adding this dependency at all changes the fingerprint, so the first OTA after this
    // lands needs a fresh native build on both stores (docs/mobile/ota.md).
    '@sentry/react-native/expo',
    // Google AdMob (issue #50). Unlike Sentry above, this plugin's props MUST be passed — the
    // native SDK crashes at startup without an app id — so they come from the checked-in static
    // config (src/ads/config.ts), never from env: plugin props are a runtimeVersion fingerprint
    // input, and an env-derived id would give the OTA lane a different fingerprint from the store
    // lanes. `userTrackingUsageDescription` is the ATT prompt copy; expo-tracking-transparency is
    // a plain dependency (no plugin entry of its own) so exactly one plugin writes that key.
    [
      'react-native-google-mobile-ads',
      {
        androidAppId: ADMOB.androidAppId,
        iosAppId: ADMOB.iosAppId,
        userTrackingUsageDescription:
          '允許追蹤後，你看到的廣告會更貼近你的興趣。· Allowing tracking lets the ads you see be more relevant to you.',
        skAdNetworkItems: ADMOB_SKADNETWORK_IDS,
      },
    ],
    // Injects the Live Activity widget-extension target into the CNG-generated Xcode project
    // (issue #43) and copies the shared ActivityKit contract into it. Kept BEFORE RNRepo, which
    // wants to run last, and after everything that could still rename the app target.
    './plugins/withLiveActivity',
    // Patches the CNG-generated AppDelegate so a NULL APNs registration error can't kill the app
    // (Sentry TRMISSION-MOBILE-4 — iOS 26/27 violates UIKit's own nonnull contract and Expo's
    // Swift delegate chain segfaults bridging the null back to NSError). The plugin's header has
    // the full mechanism; it throws if the Expo template moves out from under its anchors.
    './plugins/withRemoteNotificationErrorGuard',
    // RNRepo swaps source compilation of the covered autolinked native modules (Skia, Reanimated,
    // Worklets, gesture-handler, screens) for prebuilt, GPG-signed AARs from its public Maven — the
    // dominant cost of the Android CI native build. Anything uncovered (e.g. expo-modules-core on RN
    // 0.85) falls back to building from source automatically, so this can only speed up, never break.
    // Free / OSS, no account — allowed under the "no PAID SaaS" rule (see apps/mobile/CLAUDE.md). Kept
    // LAST so it sees every autolinked module after the other plugins have configured Gradle. Applies
    // to iOS too; set DISABLE_RNREPO=1 on an `expo prebuild` to bypass. Its `.rnrepo-cache` is
    // fingerprint-ignored (.fingerprintignore) so the prebuilt-vs-source choice never shifts the OTA
    // runtimeVersion. Companion `@rnrepo/build-tools` is a direct dep too (hoisted node_modules).
    '@rnrepo/expo-config-plugin',
  ],
  // Pure JS-visible runtime config, read back through src/config.ts. Two properties to keep in
  // mind: an applied OTA update REPLACES this whole block with the publish lane's evaluation of it
  // (so every env var feeding it must be set on that lane too), and it is skipped from the
  // runtimeVersion fingerprint (fingerprint.config.js) — nothing native may hang off it.
  extra: {
    serverOrigin,
    // Fallback only, for the RNW web harness: on a device src/config.ts reads the build number off
    // the native binary (expo-application), because this copy arrives from whichever bundle is
    // running and the OTA lane has no release tag to stamp (issue #55).
    buildNumber: BUILD_NUMBER,
    gitCommit: GIT_COMMIT,
    // Google Sign-In client ids (native app + the server "web" audience). Real values are
    // provisioned at store-setup time (P6); the server accepts the native ids via
    // GOOGLE_MOBILE_CLIENT_IDS. Empty here ⇒ the Google button no-ops until configured.
    googleWebClientId: process.env.TRM_GOOGLE_WEB_CLIENT_ID ?? '',
    googleIosClientId: process.env.TRM_GOOGLE_IOS_CLIENT_ID ?? '',
    // Sentry runtime config (src/config.ts → src/app/sentry.ts). A DSN is a public ingest
    // endpoint, not a credential; the source-map auth token is a build-time env var and never
    // appears here. Empty DSN ⇒ the SDK is never initialised.
    sentryDsn: process.env.TRM_SENTRY_DSN ?? '',
    sentryEnvironment: process.env.TRM_SENTRY_ENVIRONMENT ?? '',
    sentryTracesSampleRate: process.env.TRM_SENTRY_TRACES_SAMPLE_RATE ?? '',
    sentryReplaySampleRate: process.env.TRM_SENTRY_REPLAY_SAMPLE_RATE ?? '',
    sentryReplayErrorSampleRate: process.env.TRM_SENTRY_REPLAY_ERROR_SAMPLE_RATE ?? '',
    // AdMob runtime config (src/config.ts → src/ads/). Literals from the ADMOB block above, so the
    // plugin's app ids and the units the app requests against can never drift — and unlike the
    // TRM_* vars around them these are lane-independent, so an OTA manifest's `extra` (which
    // REPLACES the binary's) can never disagree with the native app id baked into the build.
    // Both platforms' unit ids ship in both binaries; `src/ads/ads.ts` picks by Platform.OS. The
    // unused half is a public id compiled into a binary that never requests it — nothing to protect.
    admob: { enabled: ADMOB.enabled, units: ADMOB.units },
  },
};

// GoogleSignIn's pinned pod version (~> 8.0, see RNGoogleSignin.podspec) pulls in AppCheckCore,
// whose deps GoogleUtilities/RecaptchaInterop don't define Swift modules — CocoaPods refuses to
// link them as static libraries and fails `pod install` outright. `ios/` is CNG (regenerated by
// `expo prebuild`, never committed — see CLAUDE.md), so there's no committed Podfile to hand-edit;
// inject CocoaPods' own suggested fix (a global `use_modular_headers!`) right after prebuild
// writes the Podfile template to disk.
const withGoogleSignInModularHeaders = (expoConfig: ExpoConfig): ExpoConfig =>
  withDangerousMod(expoConfig, [
    'ios',
    (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfilePath, 'utf8');
      if (!contents.includes('use_modular_headers!')) {
        const patched = contents.replace(/^(platform :ios.*)$/m, '$1\nuse_modular_headers!');
        if (patched === contents) {
          throw new Error(
            "withGoogleSignInModularHeaders: couldn't find a `platform :ios` line in the generated Podfile to anchor `use_modular_headers!` after — template must have changed.",
          );
        }
        fs.writeFileSync(podfilePath, patched);
      }
      return modConfig;
    },
  ]);

// `expo prebuild`'s template caps the Gradle daemon at -XX:MaxMetaspaceSize=512m, which OOMs
// `lintVitalAnalyzeRelease` on this app's large autolinked module graph (skia, reanimated,
// worklets, ...) on release builds. Raise the budget — CI runners have plenty of headroom.
export default withGradleProperties(withGoogleSignInModularHeaders(config), (modConfig) => {
  const jvmArgs = modConfig.modResults.find(
    (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs',
  );
  const value = '-Xmx4096m -XX:MaxMetaspaceSize=1536m';
  if (jvmArgs?.type === 'property') {
    jvmArgs.value = value;
  } else {
    modConfig.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value });
  }

  // CI-only ABI scoping for builds that never reach Play (see mobile-android.yml) — narrows the
  // template's default armeabi-v7a/arm64-v8a/x86/x86_64 reactNativeArchitectures list to cut the
  // serialized per-ABI native build. Unset (local dev, real release tags) leaves the template
  // default, which is Play's actual distribution matrix, untouched.
  if (process.env.TRM_ANDROID_ABIS) {
    const abis = modConfig.modResults.find(
      (item) => item.type === 'property' && item.key === 'reactNativeArchitectures',
    );
    if (abis?.type === 'property') {
      abis.value = process.env.TRM_ANDROID_ABIS;
    } else {
      modConfig.modResults.push({
        type: 'property',
        key: 'reactNativeArchitectures',
        value: process.env.TRM_ANDROID_ABIS,
      });
    }
  }

  return modConfig;
});
