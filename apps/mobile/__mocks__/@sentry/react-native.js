/**
 * Auto-applied jest mock for `@sentry/react-native`.
 *
 * The real package reaches for its native module (RNSentry) at import time, which jest-expo's
 * auto-mock does not provide, and `Sentry.wrap` pulls in the whole performance/profiling graph —
 * none of which any test wants. Every export used by the app is stubbed here with the same shape
 * the uninitialised SDK has in production (inert, returns an event id, `isInitialized()` false), so
 * tests exercise exactly the "no DSN configured" path.
 *
 * Keep in sync with src/app/sentry.ts: if a new Sentry API is used there, add it here.
 */
const noop = () => {};
const scope = {
  setTag: noop,
  setContext: noop,
  setLevel: noop,
  setUser: noop,
};

module.exports = {
  init: noop,
  isInitialized: () => false,
  wrap: (component) => component,
  captureException: jest.fn(() => 'test-event-id'),
  captureMessage: jest.fn(() => 'test-event-id'),
  setUser: noop,
  setTag: noop,
  setContext: noop,
  withScope: (callback) => callback(scope),
  reactNavigationIntegration: () => ({
    name: 'ReactNavigation',
    registerNavigationContainer: noop,
  }),
  mobileReplayIntegration: () => ({ name: 'MobileReplay' }),
};
