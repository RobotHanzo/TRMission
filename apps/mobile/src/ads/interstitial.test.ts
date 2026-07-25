// The caps ARE the feature. An uncapped interstitial at every game-over is exactly the
// "more than one ad per two user actions" pattern AdMob's disallowed-implementations page names,
// and the escape hatch (never block navigation) is what keeps a no-fill from stranding the player.
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  ADMOB_ENABLED: true,
}));

import { AdEventType, InterstitialAd } from 'react-native-google-mobile-ads';
import { useAds } from './ads';
import { preloadInterstitial, resetInterstitialForTest, showInterstitial } from './interstitial';

type AdDouble = ReturnType<typeof InterstitialAd.createForAdRequest> & {
  emit(type: string, payload?: unknown): void;
};

/** Preload and drive the double to LOADED, the state a real ad reaches before the player taps. */
function preloadReady(): AdDouble {
  preloadInterstitial();
  const ad = (InterstitialAd.createForAdRequest as jest.Mock).mock.results.at(-1)
    ?.value as AdDouble;
  ad.emit(AdEventType.LOADED);
  return ad;
}

/**
 * `showInterstitial` reads the persisted cap before it registers its listeners, so an event emitted
 * straight after the call would land before anything is listening — and the assertion would then
 * pass only via the 5s show-timeout, which is not the path under test. `show()` is called last, so
 * waiting for it is the signal that the listeners are live.
 */
async function untilShown(ad: AdDouble): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if ((ad.show as jest.Mock).mock.calls.length > 0) return true;
    await new Promise((r) => setTimeout(r, 0));
  }
  return false;
}

describe('offline game-over interstitial', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await resetInterstitialForTest();
    useAds.setState({ ready: true, privacyOptionsRequired: false });
  });

  it("never interrupts a player's FIRST finished game", async () => {
    const ad = preloadReady();
    await showInterstitial();
    expect(ad.show).not.toHaveBeenCalled();
  });

  it('shows on the second finished game, then holds off until the interval elapses', async () => {
    const first = preloadReady();
    await showInterstitial(); // grace game — consumed, not shown
    expect(first.show).not.toHaveBeenCalled();

    const second = preloadReady();
    const shown = showInterstitial();
    expect(await untilShown(second)).toBe(true);
    second.emit(AdEventType.CLOSED);
    await shown;

    // Straight into another game: the 3-minute floor rules it out even though one is ready.
    const third = preloadReady();
    await showInterstitial();
    expect(third.show).not.toHaveBeenCalled();
  });

  it('resolves immediately when nothing is loaded, so leaving is never blocked', async () => {
    await showInterstitial(); // grace
    preloadInterstitial(); // requested but never LOADED
    await expect(showInterstitial()).resolves.toBeUndefined();
  });

  it('resolves when the ad errors instead of closing', async () => {
    await showInterstitial(); // grace
    const ad = preloadReady();
    const shown = showInterstitial();
    expect(await untilShown(ad)).toBe(true);
    ad.emit(AdEventType.ERROR, new Error('no fill on show'));
    await expect(shown).resolves.toBeUndefined();
  });

  it('requests nothing until the SDK is up and consent allows it', () => {
    useAds.setState({ ready: false });
    preloadInterstitial();
    expect(InterstitialAd.createForAdRequest).not.toHaveBeenCalled();
  });

  it('drops a failed preload so the next game-over can try afresh', () => {
    const ad = preloadReady();
    ad.emit(AdEventType.ERROR, new Error('no fill'));
    preloadInterstitial();
    expect(InterstitialAd.createForAdRequest).toHaveBeenCalledTimes(2);
  });
});
