import type { ExpoConfig } from 'expo/config';

// Build number is the forced-update gate axis (compared against GET /version/mobile.minBuild).
// Bump it on every store submission; keep it in lockstep with versionCode/buildNumber in P6.
const BUILD_NUMBER = 1;

const config: ExpoConfig = {
  name: 'TRMission',
  slug: 'trmission',
  scheme: 'trmission', // trmission:// OAuth deep-link fallback (P0 accepts it)
  version: '0.1.0',
  orientation: 'default', // tablets unlock; phone default is portrait (enforced per-screen in P2)
  // New Architecture is the default (and only) mode in RN 0.85 / SDK 56 — no flag needed.
  ios: {
    bundleIdentifier: 'tw.trmission.app',
    supportsTablet: true, // iPad; requireFullScreen deliberately unset (iPadOS 26 ignores it)
    associatedDomains: ['applinks:trmission.example'], // real origin filled in P6
  },
  android: {
    package: 'tw.trmission.app',
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'trmission.example', pathPrefix: '/m/callback' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-secure-store',
    'expo-apple-authentication',
    ['@react-native-google-signin/google-signin', {}],
    'expo-notifications',
  ],
  extra: {
    serverOrigin: process.env.TRM_SERVER_ORIGIN ?? 'http://localhost:3001',
    buildNumber: BUILD_NUMBER,
    // Google Sign-In client ids (native app + the server "web" audience). Real values are
    // provisioned at store-setup time (P6); the server accepts the native ids via
    // GOOGLE_MOBILE_CLIENT_IDS. Empty here ⇒ the Google button no-ops until configured.
    googleWebClientId: process.env.TRM_GOOGLE_WEB_CLIENT_ID ?? '',
    googleIosClientId: process.env.TRM_GOOGLE_IOS_CLIENT_ID ?? '',
  },
};

export default config;
