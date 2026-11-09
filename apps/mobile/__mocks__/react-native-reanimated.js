/**
 * Manual jest mock for react-native-reanimated (v4).
 *
 * Reanimated 4 initialises `react-native-worklets`' NATIVE module at import time, which throws
 * under jest ("Native part of Worklets doesn't seem to be initialized"). The library's own
 * `mock.js` is a pure-JS stand-in (shared values as plain objects, `withTiming`/`withDelay`
 * resolve immediately, `useAnimatedStyle` runs the updater inline) — exactly right for logic
 * tests. Jest applies this automatically for every mobile test because it is a node_modules
 * manual mock under `<rootDir>/__mocks__` (no `jest.mock` call needed).
 *
 * Reanimated >= 4.7 still imports its real entry point from `mock.js`, which registers a CSS
 * event handler on the JS fallback module at import time and throws there. Stub just that call.
 */
jest.mock('react-native-reanimated/src/css/native/proxy', () => ({
  ...jest.requireActual('react-native-reanimated/src/css/native/proxy'),
  setCSSEventHandler: () => {},
}));

module.exports = require('react-native-reanimated/mock');
