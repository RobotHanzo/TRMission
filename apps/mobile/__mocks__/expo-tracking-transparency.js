/**
 * Auto-applied jest mock for `expo-tracking-transparency` (ATT). Its native module isn't present
 * under jest-expo, and there is no OS prompt to drive in a test. Reports "already granted" so
 * `initAds` walks past the request without a prompt; tests that care re-mock these per case.
 */
const permission = {
  status: 'granted',
  granted: true,
  expires: 'never',
  canAskAgain: false,
};

module.exports = {
  getTrackingPermissionsAsync: jest.fn(async () => ({ ...permission })),
  requestTrackingPermissionsAsync: jest.fn(async () => ({ ...permission })),
  isAvailable: jest.fn(() => false),
};
