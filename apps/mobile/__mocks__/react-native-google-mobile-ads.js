/**
 * Auto-applied jest mock for `react-native-google-mobile-ads`. The real package is a TurboModule
 * wrapper — under jest-expo it has no native side, and its `BannerAd` renders a native component
 * that react-test-renderer can't host (same class as the Skia mock beside this file).
 *
 * Faithful in the ways tests actually assert: `TestIds` are non-empty strings (so `__DEV__` unit-id
 * resolution behaves like a real dev build), the consent helpers resolve to "no consent required,
 * ads allowed", and `InterstitialAd.createForAdRequest` hands back a controllable double whose
 * listeners tests can fire. `jest.spyOn` on any of these still works — they are plain jest.fn()s.
 */
const React = require('react');

const AdEventType = {
  LOADED: 'loaded',
  ERROR: 'error',
  OPENED: 'opened',
  PAID: 'paid',
  CLICKED: 'clicked',
  CLOSED: 'closed',
};

const AdsConsentStatus = {
  UNKNOWN: 'UNKNOWN',
  REQUIRED: 'REQUIRED',
  NOT_REQUIRED: 'NOT_REQUIRED',
  OBTAINED: 'OBTAINED',
};

const AdsConsentPrivacyOptionsRequirementStatus = {
  UNKNOWN: 'UNKNOWN',
  REQUIRED: 'REQUIRED',
  NOT_REQUIRED: 'NOT_REQUIRED',
};

const defaultConsentInfo = {
  status: AdsConsentStatus.NOT_REQUIRED,
  canRequestAds: true,
  privacyOptionsRequirementStatus: AdsConsentPrivacyOptionsRequirementStatus.NOT_REQUIRED,
  isConsentFormAvailable: false,
};

const AdsConsent = {
  requestInfoUpdate: jest.fn(async () => ({ ...defaultConsentInfo })),
  showForm: jest.fn(async () => ({ ...defaultConsentInfo })),
  showPrivacyOptionsForm: jest.fn(async () => ({ ...defaultConsentInfo })),
  loadAndShowConsentFormIfRequired: jest.fn(async () => ({ ...defaultConsentInfo })),
  getConsentInfo: jest.fn(async () => ({ ...defaultConsentInfo })),
  gatherConsent: jest.fn(async () => ({ ...defaultConsentInfo })),
  getTCString: jest.fn(async () => ''),
  getGdprApplies: jest.fn(async () => false),
  getPurposeConsents: jest.fn(async () => ''),
  getPurposeLegitimateInterests: jest.fn(async () => ''),
  getUserChoices: jest.fn(async () => ({})),
  reset: jest.fn(),
};

/** A loadable/showable interstitial double: `emit(type)` fires whatever the code registered. */
function makeFullScreenAd(adUnitId) {
  const listeners = new Map();
  return {
    adUnitId,
    loaded: false,
    load: jest.fn(),
    show: jest.fn(async () => undefined),
    addAdEventListener: jest.fn((type, listener) => {
      const forType = listeners.get(type) ?? new Set();
      forType.add(listener);
      listeners.set(type, forType);
      return () => forType.delete(listener);
    }),
    addAdEventsListener: jest.fn(() => () => undefined),
    removeAllListeners: jest.fn(() => listeners.clear()),
    /** Test-only. */
    emit: (type, payload) => {
      for (const listener of listeners.get(type) ?? []) listener(payload);
    },
  };
}

const mobileAds = jest.fn(() => ({
  initialize: jest.fn(async () => []),
  setRequestConfiguration: jest.fn(async () => undefined),
  openAdInspector: jest.fn(async () => undefined),
  openDebugMenu: jest.fn(),
  setAppVolume: jest.fn(),
  setAppMuted: jest.fn(),
}));

module.exports = {
  __esModule: true,
  default: mobileAds,
  MobileAds: mobileAds,
  AdEventType,
  RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' },
  AdsConsent,
  AdsConsentStatus,
  AdsConsentPrivacyOptionsRequirementStatus,
  AdsConsentDebugGeography: { DISABLED: 0, EEA: 1, REGULATED_US_STATE: 3, OTHER: 4 },
  MaxAdContentRating: { G: 'G', PG: 'PG', T: 'T', MA: 'MA' },
  BannerAdSize: {
    BANNER: 'BANNER',
    FULL_BANNER: 'FULL_BANNER',
    LARGE_BANNER: 'LARGE_BANNER',
    LEADERBOARD: 'LEADERBOARD',
    MEDIUM_RECTANGLE: 'MEDIUM_RECTANGLE',
    ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER',
    LARGE_ANCHORED_ADAPTIVE_BANNER: 'LARGE_ANCHORED_ADAPTIVE_BANNER',
    INLINE_ADAPTIVE_BANNER: 'INLINE_ADAPTIVE_BANNER',
    WIDE_SKYSCRAPER: 'WIDE_SKYSCRAPER',
  },
  TestIds: {
    APP_OPEN: 'ca-app-pub-3940256099942544/9257395921',
    ADAPTIVE_BANNER: 'ca-app-pub-3940256099942544/9214589741',
    BANNER: 'ca-app-pub-3940256099942544/6300978111',
    INTERSTITIAL: 'ca-app-pub-3940256099942544/1033173712',
    REWARDED: 'ca-app-pub-3940256099942544/5224354917',
    REWARDED_INTERSTITIAL: 'ca-app-pub-3940256099942544/5354046379',
    NATIVE: 'ca-app-pub-3940256099942544/2247696110',
  },
  BannerAd: (props) => React.createElement('BannerAd', { testID: 'banner-ad', ...props }),
  InterstitialAd: { createForAdRequest: jest.fn((adUnitId) => makeFullScreenAd(adUnitId)) },
  AppOpenAd: { createForAdRequest: jest.fn((adUnitId) => makeFullScreenAd(adUnitId)) },
  RewardedAd: { createForAdRequest: jest.fn((adUnitId) => makeFullScreenAd(adUnitId)) },
};
