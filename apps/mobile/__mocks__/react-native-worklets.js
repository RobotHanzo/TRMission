/**
 * Manual jest mock for react-native-worklets (v0.13+).
 *
 * Reanimated 4.7 runs `runOnUISync(...)` at import time, which the pure-JS ("web") build that
 * `jest.resolver.js` falls back to rejects ("not supported on web"). The library ships its own
 * jest mock (`lib/module/mock`) that runs worklets inline, so use it for every mobile test.
 */
module.exports = require('react-native-worklets/lib/module/mock');
