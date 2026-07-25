// @expo/fingerprint config — the input set behind `runtimeVersion: { policy: 'fingerprint' }`
// (app.config.ts). Read by BOTH sides of the OTA contract: the native build lanes bake the
// resulting hash into the binary, and `eoas publish` stamps updates with it. A binary only ever
// sees updates whose fingerprint is byte-identical to its own, so anything hashed here that is
// NOT part of the native surface silently fences OTA off (issue #55).
//
// The two skips below remove exactly that: config fields that change per RELEASE, not per native
// surface. Without them the store lanes (BUILD_NUMBER/APP_VERSION injected from the release tag,
// `extra.gitCommit` = the built commit) and the OTA lane (no version env, a later commit) compute
// different runtime versions from an identical native tree, and no published update ever matches
// a shipped binary. Measured 2026-07-26 on this tree, ios, `expo-updates runtimeversion:resolve`:
// `88f7773b…` with the OTA lane's env vs `325656c1…` with `BUILD_NUMBER=17 APP_VERSION=0.2.17` —
// the only differing fingerprint source was the `expoConfig` contents.
//
//  - ExpoConfigVersions     → `version`, `android.versionCode`, `ios.buildNumber`. A marketing
//                             version / build number bump is not a native change; the store
//                             binaries and the OTA bundle must share one runtime version across it.
//  - ExpoConfigExtraSection → the whole `extra` block (`buildNumber`, `gitCommit`, serverOrigin,
//                             the Google client ids, TRM_SENTRY_*, the AdMob unit ids). `extra` is
//                             pure JS-visible runtime config — an applied update REPLACES it on the
//                             device anyway, so hashing it is backwards. Everything in there with a
//                             native counterpart is hashed through that counterpart instead: the
//                             AdMob app ids via the config-plugin props, `serverOrigin` via
//                             `associatedDomains` / the Android intent filters, the iOS Google
//                             client id via the google-signin plugin's `iosUrlScheme`.
//
// Because `extra` no longer reaches the fingerprint, values the app must trust across an OTA can no
// longer be read from it — `src/config.ts` takes the build number and marketing version from
// expo-application (the NATIVE Info.plist / versionCode), not from `extra`/`expoConfig.version`.
// See docs/mobile/ota.md.
//
// CHANGING THIS FILE CHANGES EVERY RUNTIME VERSION. Old binaries stop matching new updates until a
// fresh native build ships on both stores — the same rule as adding a native dependency.

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips: ['ExpoConfigVersions', 'ExpoConfigExtraSection'],
};
