import { withDangerousMod, withGradleProperties } from '@expo/config-plugins';
import type { ExpoConfig } from 'expo/config';
import fs from 'node:fs';
import path from 'node:path';

// Build number is the forced-update gate axis (compared against GET /version/mobile.minBuild) AND
// the native versionCode/CFBundleVersion (docs/release/mobile-versioning.md). The release workflows
// derive it from the release tag (`v<semver>+<build>`) and inject it via this env var at
// `expo prebuild` time; local/dev builds fall back to 1 and are never shipped.
const BUILD_NUMBER = Number(process.env.BUILD_NUMBER ?? 1);

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

const config: ExpoConfig = {
  name: 'TRMission',
  slug: 'trmission',
  scheme: 'trmission', // trmission:// OAuth deep-link fallback (P0 accepts it)
  version: '0.1.0',
  orientation: 'default', // tablets unlock; phone default is portrait (enforced per-screen in P2)
  // The shared TRMission rail-ticket mark — the same logo as the web favicon
  // (apps/web/public/icon.svg), ported to the native sizes/masks by scripts/gen-brand-assets.js.
  // Full-bleed square: the OS applies its own mask. Also the Android legacy icon + web favicon
  // fallback (ios.icon below overrides this trio for iOS specifically).
  icon: './assets/icon.png',
  // Chrome theming follows the OS + the in-app theme setting (theme/useTheme.ts).
  userInterfaceStyle: 'automatic',
  // New Architecture is the default (and only) mode in RN 0.85 / SDK 56 — no flag needed.
  ios: {
    // iOS 26 Liquid Glass icon trio (@expo/prebuild-config's withIosIcons): `light` is the brand
    // mark, `dark` deepens the tile for a dark springboard, `tinted` is de-hued so the system's own
    // Liquid Glass tint + specular pass reads cleanly (see the header comment in
    // scripts/gen-brand-assets.js for why this is flat PNGs and not an Icon Composer `.icon` bundle).
    icon: {
      light: './assets/icon.png',
      dark: './assets/icon-dark.png',
      tinted: './assets/icon-tinted.png',
    },
    bundleIdentifier: 'dev.robothanzo.trmission',
    buildNumber: String(BUILD_NUMBER),
    supportsTablet: true, // iPad; requireFullScreen deliberately unset (iPadOS 26 ignores it)
    associatedDomains: [`applinks:${serverHost}`],
    config: {
      // Standard TLS only (exempt) — answers App Store Connect's export-compliance question so
      // TestFlight/App Store submissions don't stall on the manual prompt.
      usesNonExemptEncryption: false,
    },
    // Apple privacy manifest (ITMS-91053): the required-reason APIs this app's dependency graph
    // touches — AsyncStorage/UserDefaults (CA92.1), file timestamps (expo-updates/sqlite/
    // file-system, C617.1), free disk space (E174.1), system boot time (uptime clocks, 35F9.1).
    // No tracking, no tracking domains; App Store Connect's App Privacy questionnaire (accounts,
    // UGC, push tokens — no ads/analytics) is filled separately per docs/release/*.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
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
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: serverHost, pathPrefix: '/m/callback' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    // No ads/analytics anywhere in the app: block the advertising-id permission outright so a
    // transitive Play Services dependency can never re-add it behind the Data-safety form's back.
    blockedPermissions: ['com.google.android.gms.permission.AD_ID'],
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
    // expo-open-ota resolves the update branch from this channel header (production|preview).
    requestHeaders: { 'expo-channel-name': process.env.TRM_OTA_CHANNEL ?? 'production' },
  },
  // An OTA can never land on an incompatible native build: the fingerprint hashes the whole
  // native surface (modules, SDK, config plugins), so mismatched binaries ignore the update.
  runtimeVersion: { policy: 'fingerprint' },
  plugins: [
    'expo-secure-store',
    'expo-apple-authentication',
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
  extra: {
    serverOrigin,
    buildNumber: BUILD_NUMBER,
    // Google Sign-In client ids (native app + the server "web" audience). Real values are
    // provisioned at store-setup time (P6); the server accepts the native ids via
    // GOOGLE_MOBILE_CLIENT_IDS. Empty here ⇒ the Google button no-ops until configured.
    googleWebClientId: process.env.TRM_GOOGLE_WEB_CLIENT_ID ?? '',
    googleIosClientId: process.env.TRM_GOOGLE_IOS_CLIENT_ID ?? '',
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
