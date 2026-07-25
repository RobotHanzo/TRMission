// The app's single interstitial: shown when a FINISHED offline vs-bots game is left.
//
// Why only there, and why capped this hard (docs/plans/2026-07-25-mobile-admob.md): AdMob's
// interstitial guidance allows full-screen ads at genuine stage transitions and forbids them on app
// load/exit, back-to-back, or more than once per two user actions. The end of an offline game is
// the one real stage boundary in this app — and even there, a player's FIRST finished game never
// gets one, so a new player's first experience of the app is clean.
//
// The ad is preloaded when the game reaches GAME_OVER and shown on the explicit "play again" /
// "back home" tap, which doubles as the "insert a delay before the ad" mitigation for
// repeated-tapping users. It can never block navigation: with nothing loaded, `showInterstitial`
// resolves immediately.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { InterstitialAd } from 'react-native-google-mobile-ads';
import { adUnitId, useAds } from './ads';
import { GMA } from './googleMobileAds';

/** Device-local cap state. Not account-synced — frequency capping is about this device's session. */
const CAP_KEY = 'trm.ads.interstitial.v1';
/** Minimum gap between two interstitials, whatever the user does in between. */
const MIN_INTERVAL_MS = 3 * 60 * 1000;
/** Finished offline games that pass before the first interstitial is eligible. */
const GRACE_GAMES = 1;
/** Hard ceiling on how long a `show()` may hold the caller before navigation proceeds anyway. */
const SHOW_TIMEOUT_MS = 5000;

interface CapState {
  lastShownAt: number;
  finishedGames: number;
}

async function readCap(): Promise<CapState> {
  try {
    const raw = await AsyncStorage.getItem(CAP_KEY);
    if (!raw) return { lastShownAt: 0, finishedGames: 0 };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { lastShownAt: 0, finishedGames: 0 };
    const { lastShownAt, finishedGames } = parsed as Partial<CapState>;
    return {
      lastShownAt: typeof lastShownAt === 'number' ? lastShownAt : 0,
      finishedGames: typeof finishedGames === 'number' ? finishedGames : 0,
    };
  } catch {
    return { lastShownAt: 0, finishedGames: 0 };
  }
}

const writeCap = (next: CapState): Promise<void> =>
  AsyncStorage.setItem(CAP_KEY, JSON.stringify(next)).catch(() => undefined);

let ad: InterstitialAd | null = null;
let loaded = false;

/**
 * Start fetching the ad so it is ready by the time the player taps away from the scoreboard.
 * Idempotent; a no-op when ads are off, unconsented, or already in flight.
 */
export function preloadInterstitial(): void {
  const gma = GMA;
  const unitId = adUnitId('offlineGameEnd');
  if (!gma || !unitId || !useAds.getState().ready || ad) return;
  const next = gma.InterstitialAd.createForAdRequest(unitId);
  next.addAdEventListener(gma.AdEventType.LOADED, () => {
    loaded = true;
  });
  next.addAdEventListener(gma.AdEventType.ERROR, () => {
    // No fill / network error: drop it so the next game-over can try afresh.
    ad?.removeAllListeners();
    ad = null;
    loaded = false;
  });
  ad = next;
  next.load();
}

/**
 * Count a finished offline game and, if every cap allows it, show the preloaded interstitial.
 * Always resolves — on a skip immediately, on a show once the user dismisses it (or after
 * `SHOW_TIMEOUT_MS`, so a wedged SDK can never strand the player on the scoreboard).
 */
export async function showInterstitial(): Promise<void> {
  const gma = GMA;
  const shown = ad;
  const cap = await readCap();
  const played = cap.finishedGames + 1;
  const now = Date.now();
  const eligible =
    loaded &&
    gma !== null &&
    shown !== null &&
    played > GRACE_GAMES &&
    now - cap.lastShownAt >= MIN_INTERVAL_MS;

  if (!eligible || !gma || !shown) {
    await writeCap({ ...cap, finishedGames: played });
    return;
  }

  await writeCap({ lastShownAt: now, finishedGames: played });
  // Consumed either way: an interstitial instance is single-use, and a failed show must not leave a
  // stale one behind for the next game.
  ad = null;
  loaded = false;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      shown.removeAllListeners();
      resolve();
    };
    const timer = setTimeout(finish, SHOW_TIMEOUT_MS);
    shown.addAdEventListener(gma.AdEventType.CLOSED, finish);
    shown.addAdEventListener(gma.AdEventType.ERROR, finish);
    shown.show().catch(finish);
  });
}

/** Test seam: drop any preloaded ad and forget the cap. Never call this from app code. */
export async function resetInterstitialForTest(): Promise<void> {
  ad?.removeAllListeners();
  ad = null;
  loaded = false;
  await AsyncStorage.removeItem(CAP_KEY).catch(() => undefined);
}
