// Learn more: https://docs.expo.dev/guides/monorepo/
// getSentryExpoConfig, NOT expo's getDefaultConfig + Sentry's withSentryConfig: the latter is the
// BARE-React-Native path, and it installs Sentry's own Metro serializer wrapped around whatever
// `serializer.customSerializer` it finds. Expo always sets one, and on Metro 0.84 (SDK 56 / RN
// 0.85) its result is no longer a shape Sentry's `extractSerializerResult` understands, so the
// wrapper reads `.code` off undefined and every release bundle dies with
// "TypeError: Cannot read properties of undefined (reading 'match')" in
// determineDebugIdFromBundleSource — dev bundling is unaffected (the serializer early-returns on
// `hot`/`dev`), which is why this only ever broke `createBundleReleaseJsAndAssets` in CI.
// getSentryExpoConfig instead hands the debug-ID module to Expo through its documented
// `unstable_beforeAssetSerializationPlugins` hook and leaves Expo's serializer in sole charge.
// It applies every other piece withSentryConfig does (frames-collapsed, resolvers, dev middleware,
// options file), so this is a like-for-like swap, not a feature drop.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

// Stamps a debug id into the bundle + source map so the maps uploaded by the release lanes bind
// to the exact bundle that shipped. Harmless when Sentry is unconfigured — it only adds the id.
const config = getSentryExpoConfig(projectRoot);

// Watch the whole monorepo so Metro picks up the TS-source @trm/* packages (no build step).
config.watchFolders = [workspaceRoot];

// Resolve deps from the app first, then the hoisted root — Yarn node-modules layout.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// The @trm/* packages export raw TS via an `exports` map with no `main` — package-exports
// resolution (default on modern Metro) is required. Assert it rather than assume, so a Metro
// bump that flips the default fails loud here instead of at bundle time.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
