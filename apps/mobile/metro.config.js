// Learn more: https://docs.expo.dev/guides/monorepo/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

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
