import type { ExpoConfig } from 'expo/config';

// Build number is the forced-update gate axis (compared against GET /version/mobile.minBuild).
// Bump it on every store submission; keep it in lockstep with versionCode/buildNumber in P6.
const BUILD_NUMBER = 1;

// The google-signin config plugin (without-Firebase mode) VALIDATES `iosUrlScheme` at every config
// eval — for `expo run:android`/`prebuild` too, not just iOS — and rejects anything not prefixed
// `com.googleusercontent.apps.`. That's the reversed iOS OAuth client id (shown as its own value in
// the Google console). Provisioned at store-setup (P6) via TRM_GOOGLE_IOS_URL_SCHEME; until then a
// format-valid placeholder lets native builds run — consistent with the Google button no-op'ing
// until real client ids land (see `extra` below).
const googleIosUrlScheme =
  process.env.TRM_GOOGLE_IOS_URL_SCHEME ?? 'com.googleusercontent.apps.placeholder';

const config: ExpoConfig = {
  name: 'TRMission',
  slug: 'trmission',
  scheme: 'trmission', // trmission:// OAuth deep-link fallback (P0 accepts it)
  version: '0.1.0',
  orientation: 'default', // tablets unlock; phone default is portrait (enforced per-screen in P2)
  // The shared TRMission rail-ticket mark — the same logo as the web favicon
  // (apps/web/public/icon.svg), ported to the native sizes/masks by scripts/gen-brand-assets.js.
  // Full-bleed square: the OS applies its own mask.
  icon: './assets/icon.png',
  // Chrome theming follows the OS + the in-app theme setting (theme/useTheme.ts).
  userInterfaceStyle: 'automatic',
  // New Architecture is the default (and only) mode in RN 0.85 / SDK 56 — no flag needed.
  ios: {
    bundleIdentifier: 'tw.trmission.app',
    supportsTablet: true, // iPad; requireFullScreen deliberately unset (iPadOS 26 ignores it)
    associatedDomains: ['applinks:trmission.example'], // real origin filled in P6
  },
  android: {
    package: 'tw.trmission.app',
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
        data: [{ scheme: 'https', host: 'trmission.example', pathPrefix: '/m/callback' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  updates: {
    // Self-hosted expo-open-ota manifest endpoint (docs/mobile/ota.md). The origin is a
    // deploy-time repo variable so dev builds can point at the local compose container.
    // NEVER an EAS URL — no EAS anywhere in this project.
    url: process.env.TRM_OTA_URL ?? 'http://localhost:3005/manifest',
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
    'expo-notifications',
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
  ],
  extra: {
    serverOrigin: process.env.TRM_SERVER_ORIGIN ?? 'https://trmission.robothanzo.dev',
    buildNumber: BUILD_NUMBER,
    // Google Sign-In client ids (native app + the server "web" audience). Real values are
    // provisioned at store-setup time (P6); the server accepts the native ids via
    // GOOGLE_MOBILE_CLIENT_IDS. Empty here ⇒ the Google button no-ops until configured.
    googleWebClientId: process.env.TRM_GOOGLE_WEB_CLIENT_ID ?? '',
    googleIosClientId: process.env.TRM_GOOGLE_IOS_CLIENT_ID ?? '',
  },
};

export default config;
