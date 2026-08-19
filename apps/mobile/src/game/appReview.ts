// The iOS App Store review sheet (StoreKit, via expo-store-review), offered after a finished game.
//
// The OS is the real rate limiter — it presents the sheet a handful of times a year at most, never
// twice for the same app version, and silently does nothing the rest of the time. So everything
// here exists to spend those scarce slots on a good moment, not to enforce a cap of our own:
//
//   - **iOS only.** Android's equivalent is Play In-App Review, a separate policy surface we have
//     not taken on. There this no-ops rather than falling through to `requestReview()`'s store-link
//     fallback, which would yank the player out of the app instead of prompting inside it.
//   - **The first `GRACE_GAMES` finished games are never interrupted** — the same "a newcomer's
//     first game stays clean" rule the interstitial follows (`../ads/interstitial.ts`). It also
//     keeps the sheet clear of `../push/PushPrompt.tsx`, the one-shot push ask that already owns
//     the game-over panel after the player's FIRST finished game.
//   - **Once per app version, and never within `MIN_INTERVAL_MS`.** A player who ignored the sheet
//     is not asked again next session; iOS would swallow the request anyway, and a swallowed
//     request still burns one of the year's slots.
//   - **Never right after a poor in-app rating** — the caller withholds `ready` when the player has
//     just told us the game was mediocre (`../components/game/ScoreBoard.tsx`). Asking the App
//     Store at that exact moment invites the review we were just handed privately.
//
// Apple requires the system sheet for this (custom rate-us prompts are disallowed) and it must
// never gate content — a passive post-game offer is exactly the sanctioned shape. Every storage
// failure is swallowed: the worst case is one prompt more or fewer than intended, never a crash.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { APP_VERSION } from '../config';

/** Device-local, deliberately not account-synced: the sheet's quota is per device, like the OS's. */
const KEY = 'trm.appReview.v1';
/** Finished games that pass before the sheet is ever offered. */
export const GRACE_GAMES = 2;
/** Minimum gap between two requests, whatever else happens in between. */
const MIN_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
/** Let the scoreboard land — confetti, the score reveal, the rating block's thanks — before the
 *  OS takes the screen. Short enough that a player who is still reading is the one who sees it. */
const PROMPT_DELAY_MS = 2500;

interface ReviewState {
  /** Games this device has played to game over (replays and encyclopedia clips excluded). */
  finishedGames: number;
  /** Epoch ms of the last request, 0 if never. */
  lastAskedAt: number;
  /** `APP_VERSION` at the last request — iOS shows the sheet once per version at most. */
  lastAskedVersion: string;
}

const EMPTY: ReviewState = { finishedGames: 0, lastAskedAt: 0, lastAskedVersion: '' };

async function read(): Promise<ReviewState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    const { finishedGames, lastAskedAt, lastAskedVersion } = parsed as Partial<ReviewState>;
    return {
      finishedGames: typeof finishedGames === 'number' ? finishedGames : 0,
      lastAskedAt: typeof lastAskedAt === 'number' ? lastAskedAt : 0,
      lastAskedVersion: typeof lastAskedVersion === 'string' ? lastAskedVersion : '',
    };
  } catch {
    return EMPTY;
  }
}

const write = (next: ReviewState): Promise<void> =>
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);

/** Count one game played through to game over. Counted on every platform so the grace window is
 *  already spent if the player later moves to an iPhone with the same account — cheap, and it
 *  keeps the counter meaning "games finished", not "games finished on iOS". */
export async function noteFinishedGame(): Promise<void> {
  const state = await read();
  await write({ ...state, finishedGames: state.finishedGames + 1 });
}

/**
 * Offer the review sheet if every gate above allows it. Resolves to whether the request was made
 * (not to what the player did — StoreKit never tells us, by design).
 */
export async function maybeRequestAppReview(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const state = await read();
  if (state.finishedGames <= GRACE_GAMES) return false;
  if (state.lastAskedVersion === APP_VERSION) return false;
  const now = Date.now();
  if (state.lastAskedAt !== 0 && now - state.lastAskedAt < MIN_INTERVAL_MS) return false;
  // False on a TestFlight build (Apple never shows the sheet there) and anywhere the native module
  // is absent — the react-native-web harness included.
  if (!(await StoreReview.isAvailableAsync())) return false;

  // Recorded BEFORE the request, so a throw mid-flight can never turn into an ask-every-game loop.
  await write({ ...state, lastAskedAt: now, lastAskedVersion: APP_VERSION });
  try {
    await StoreReview.requestReview();
  } catch {
    /* the sheet is a courtesy; a failure to present one is never worth surfacing */
  }
  return true;
}

/**
 * Drives the prompt from the scoreboard.
 *
 * @param finished the viewer just played a game through to game over (not a replay or a demo clip)
 * @param ready    nothing else is competing for their attention — safe to hand the screen to iOS
 */
export function useAppReviewPrompt(finished: boolean, ready: boolean): void {
  useEffect(() => {
    if (finished) void noteFinishedGame();
  }, [finished]);

  useEffect(() => {
    if (!finished || !ready) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void maybeRequestAppReview();
    }, PROMPT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [finished, ready]);
}

/** Test seam: forget the grace count and the last-asked record. Never call this from app code. */
export const resetAppReviewForTest = (): Promise<void> =>
  AsyncStorage.removeItem(KEY).catch(() => undefined);
