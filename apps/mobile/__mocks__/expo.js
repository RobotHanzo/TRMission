/**
 * Auto-applied jest mock for `expo`: jest-expo's own native-module auto-mock registers an `ExpoGo`
 * native module (mocks/expoModules.js), so the REAL `isRunningInExpoGo()` reports `true` under
 * every test — the opposite of a dev/production build. Force it `false` so
 * push/expoNotifications.ts and auth/googleSigninModule.ts exercise their real (non-Expo-Go) code
 * path, matching what the existing push/*.test.ts(x) files already assume. Delegate every other
 * export to the real module — expo-sqlite and others pull requireNativeModule etc. straight
 * through `expo`, and a partial mock silently breaks them.
 */
module.exports = {
  ...jest.requireActual('expo'),
  isRunningInExpoGo: () => false,
};
