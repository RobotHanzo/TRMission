import { Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import {
  maybeRequestAppReview,
  noteFinishedGame,
  resetAppReviewForTest,
  useAppReviewPrompt,
} from './appReview';

jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(),
  requestReview: jest.fn(),
}));

// Read lazily by the getter, so the version can move between tests without re-importing.
let mockAppVersion = '1.0.0';
jest.mock('../config', () => ({
  get APP_VERSION() {
    return mockAppVersion;
  },
}));

const mAvailable = StoreReview.isAvailableAsync as jest.Mock;
const mRequest = StoreReview.requestReview as jest.Mock;

const DAY_MS = 24 * 60 * 60 * 1000;
let now = Date.UTC(2026, 0, 1);

/** Play `n` games through to game over. */
const finishGames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await noteFinishedGame();
};

beforeEach(async () => {
  await AsyncStorage.clear();
  await resetAppReviewForTest();
  mockAppVersion = '1.0.0';
  now = Date.UTC(2026, 0, 1);
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mAvailable.mockReset().mockResolvedValue(true);
  mRequest.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('maybeRequestAppReview', () => {
  it("leaves a newcomer's first two finished games alone, then asks on the third", async () => {
    await finishGames(1);
    await expect(maybeRequestAppReview()).resolves.toBe(false);
    await finishGames(1);
    await expect(maybeRequestAppReview()).resolves.toBe(false);
    expect(mRequest).not.toHaveBeenCalled();

    await finishGames(1);
    await expect(maybeRequestAppReview()).resolves.toBe(true);
    expect(mRequest).toHaveBeenCalledTimes(1);
  });

  it('asks once per app version, however many games follow', async () => {
    await finishGames(3);
    await expect(maybeRequestAppReview()).resolves.toBe(true);

    await finishGames(5);
    await expect(maybeRequestAppReview()).resolves.toBe(false);
    expect(mRequest).toHaveBeenCalledTimes(1);
  });

  it('holds a new version back until the cooldown has passed', async () => {
    await finishGames(3);
    await expect(maybeRequestAppReview()).resolves.toBe(true);

    mockAppVersion = '1.1.0';
    now += 89 * DAY_MS;
    await finishGames(1);
    await expect(maybeRequestAppReview()).resolves.toBe(false);

    now += 2 * DAY_MS;
    await expect(maybeRequestAppReview()).resolves.toBe(true);
    expect(mRequest).toHaveBeenCalledTimes(2);
  });

  it('never touches StoreKit off iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await finishGames(9);
    await expect(maybeRequestAppReview()).resolves.toBe(false);
    expect(mAvailable).not.toHaveBeenCalled();
    expect(mRequest).not.toHaveBeenCalled();
  });

  it('stays quiet where the sheet is unavailable (TestFlight, web harness) without burning the slot', async () => {
    mAvailable.mockResolvedValue(false);
    await finishGames(3);
    await expect(maybeRequestAppReview()).resolves.toBe(false);
    expect(mRequest).not.toHaveBeenCalled();

    // The slot is untouched, so a later build that CAN present the sheet still gets its one ask.
    mAvailable.mockResolvedValue(true);
    await expect(maybeRequestAppReview()).resolves.toBe(true);
  });

  it('records the ask before presenting, so a throwing sheet cannot re-ask every game', async () => {
    mRequest.mockRejectedValue(new Error('StoreKit unavailable'));
    await finishGames(3);
    await expect(maybeRequestAppReview()).resolves.toBe(true);

    mRequest.mockResolvedValue(undefined);
    await finishGames(3);
    await expect(maybeRequestAppReview()).resolves.toBe(false);
    expect(mRequest).toHaveBeenCalledTimes(1);
  });

  it('survives unreadable storage by simply not asking', async () => {
    await AsyncStorage.setItem('trm.appReview.v1', 'not json');
    await expect(maybeRequestAppReview()).resolves.toBe(false);
    // …and the next games still count from scratch rather than crashing the scoreboard.
    await finishGames(3);
    await expect(maybeRequestAppReview()).resolves.toBe(true);
  });
});

describe('useAppReviewPrompt', () => {
  // `Date` stays real so the cooldown clock is still the `Date.now` spy from beforeEach.
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['Date'] }));
  afterEach(() => jest.useRealTimers());

  /** Let the effects' storage round-trips settle, then run out the prompt delay. */
  const settle = async (ms = 5000): Promise<void> => {
    await act(async () => {});
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await act(async () => {});
  };

  it('counts the finished game and offers the sheet a beat later', async () => {
    await finishGames(2);
    await renderHook(() => useAppReviewPrompt(true, true));
    await settle();
    // The third finished game is this one — counted by the hook, not by the caller.
    expect(mRequest).toHaveBeenCalledTimes(1);
  });

  it('counts the game but stays silent while the caller is not ready', async () => {
    await finishGames(2);
    await renderHook(() => useAppReviewPrompt(true, false));
    await settle();
    expect(mRequest).not.toHaveBeenCalled();

    // Nothing was spent: the next finished game still gets its ask.
    await expect(maybeRequestAppReview()).resolves.toBe(true);
  });

  it('drops the pending ask when the player leaves the scoreboard first', async () => {
    await finishGames(2);
    const { unmount } = await renderHook(() => useAppReviewPrompt(true, true));
    await act(async () => {});
    await unmount();
    await settle();
    expect(mRequest).not.toHaveBeenCalled();
  });

  it('ignores a game the viewer only watched', async () => {
    await finishGames(2);
    await renderHook(() => useAppReviewPrompt(false, false));
    await settle();
    expect(mRequest).not.toHaveBeenCalled();
    // A replay never counts toward the grace window either.
    await expect(maybeRequestAppReview()).resolves.toBe(false);
  });
});
