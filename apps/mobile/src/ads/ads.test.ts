// The consent gate is the whole point of this module: an ad must never be requested before UMP
// says it may be, and neither a UMP outage nor a denied ATT prompt may leave the app broken.
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  ADMOB_ENABLED: true,
  ADMOB_UNITS: {
    banner: { android: 'android-banner', ios: 'ios-banner' },
    offlineGameEnd: { android: 'android-interstitial', ios: 'ios-interstitial' },
  },
}));

import { Platform } from 'react-native';
import GMA, {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  MaxAdContentRating,
  TestIds,
} from 'react-native-google-mobile-ads';
import { adUnitId, initAds, resetAdsForTest, showAdPrivacyOptions, useAds } from './ads';

const consentInfo = (over: Record<string, unknown> = {}) => ({
  status: 'NOT_REQUIRED',
  canRequestAds: true,
  privacyOptionsRequirementStatus: AdsConsentPrivacyOptionsRequirementStatus.NOT_REQUIRED,
  isConsentFormAvailable: false,
  ...over,
});

describe('ads bring-up', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAdsForTest();
    (AdsConsent.gatherConsent as jest.Mock).mockResolvedValue(consentInfo());
    (AdsConsent.getConsentInfo as jest.Mock).mockResolvedValue(consentInfo());
  });

  it('gathers consent BEFORE initialising the SDK', async () => {
    const order: string[] = [];
    (AdsConsent.gatherConsent as jest.Mock).mockImplementation(async () => {
      order.push('consent');
      return consentInfo();
    });
    const initialize = jest.fn(async () => {
      order.push('initialize');
      return [];
    });
    const setRequestConfiguration = jest.fn(async () => undefined);
    (GMA as unknown as jest.Mock).mockReturnValue({ initialize, setRequestConfiguration });

    await expect(initAds()).resolves.toBe(true);
    expect(order).toEqual(['consent', 'initialize']);
    expect(useAds.getState().ready).toBe(true);
    // Everyone / PEGI 3 app ⇒ ad content capped to G.
    expect(setRequestConfiguration).toHaveBeenCalledWith({
      maxAdContentRating: MaxAdContentRating.G,
    });
  });

  it('never initialises when consent withholds ad requests', async () => {
    (AdsConsent.getConsentInfo as jest.Mock).mockResolvedValue(
      consentInfo({ canRequestAds: false }),
    );
    const initialize = jest.fn(async () => []);
    (GMA as unknown as jest.Mock).mockReturnValue({
      initialize,
      setRequestConfiguration: jest.fn(async () => undefined),
    });

    await expect(initAds()).resolves.toBe(false);
    expect(initialize).not.toHaveBeenCalled();
    expect(useAds.getState().ready).toBe(false);
  });

  it('survives a UMP failure and still consults the last known consent state', async () => {
    (AdsConsent.gatherConsent as jest.Mock).mockRejectedValue(new Error('offline'));
    const initialize = jest.fn(async () => []);
    (GMA as unknown as jest.Mock).mockReturnValue({
      initialize,
      setRequestConfiguration: jest.fn(async () => undefined),
    });

    await expect(initAds()).resolves.toBe(true);
    expect(initialize).toHaveBeenCalled();
  });

  it('runs once however often it is called', async () => {
    (GMA as unknown as jest.Mock).mockReturnValue({
      initialize: jest.fn(async () => []),
      setRequestConfiguration: jest.fn(async () => undefined),
    });
    await initAds();
    await initAds();
    expect(AdsConsent.gatherConsent).toHaveBeenCalledTimes(1);
  });

  it('exposes the privacy-options row only where UMP requires one', async () => {
    (GMA as unknown as jest.Mock).mockReturnValue({
      initialize: jest.fn(async () => []),
      setRequestConfiguration: jest.fn(async () => undefined),
    });
    await initAds();
    expect(useAds.getState().privacyOptionsRequired).toBe(false);
    // …and the form is never opened without it, because showPrivacyOptionsForm throws there.
    await expect(showAdPrivacyOptions()).resolves.toBe(false);
    expect(AdsConsent.showPrivacyOptionsForm).not.toHaveBeenCalled();

    resetAdsForTest();
    (AdsConsent.getConsentInfo as jest.Mock).mockResolvedValue(
      consentInfo({
        privacyOptionsRequirementStatus: AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
      }),
    );
    await initAds();
    expect(useAds.getState().privacyOptionsRequired).toBe(true);
    await expect(showAdPrivacyOptions()).resolves.toBe(true);
  });
});

describe('adUnitId', () => {
  it('resolves to Google test units under __DEV__, never to live inventory', () => {
    // Clicking a live ad on your own inventory is invalid traffic and can suspend the account, so
    // a developer build must be incapable of reaching one.
    expect(adUnitId('banner')).toBe(TestIds.ADAPTIVE_BANNER);
    expect(adUnitId('offlineGameEnd')).toBe(TestIds.INTERSTITIAL);
  });

  describe('in a release build', () => {
    const dev = __DEV__;
    beforeAll(() => {
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    });
    afterAll(() => {
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
    });

    // An ad unit belongs to exactly ONE AdMob app, and the Android and iOS apps are separate apps —
    // serving the other platform's id would simply never fill. Assert both directions so a
    // regression to a single shared unit id can't pass.
    it("picks this platform's unit, never the other platform's", () => {
      const [mine, theirs] =
        Platform.OS === 'ios' ? ['ios-banner', 'android-banner'] : ['android-banner', 'ios-banner'];
      expect(adUnitId('banner')).toBe(mine);
      expect(adUnitId('banner')).not.toBe(theirs);
    });

    it('keeps the two placements on their own units', () => {
      const suffix = Platform.OS === 'ios' ? 'ios' : 'android';
      expect(adUnitId('banner')).toBe(`${suffix}-banner`);
      expect(adUnitId('offlineGameEnd')).toBe(`${suffix}-interstitial`);
    });
  });
});
