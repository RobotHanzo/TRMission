// The JS face of the iOS Live Activity (ActivityKit) local Expo module — the game's turn state on
// the lock screen and the Dynamic Island (issue #43). iOS-only by construction: off iOS the native
// module is absent and every call here is a no-op returning `null`/`false`, so callers need no
// Platform checks of their own.
//
// The native side lives in `ios/` (see TRMissionActivityAttributes.swift for the shared contract);
// `plugins/withLiveActivity.js` injects the widget-extension target that renders it.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/** What `NativeModule.addListener` hands back (expo-modules-core's `EventSubscription`). */
interface NativeSubscription {
  remove(): void;
}

/** Static labels + per-seat copy, fixed for the life of one activity (see the Swift attributes). */
export interface LiveActivityAttributes {
  /** One localized turn label per seat, "your turn" phrasing at `mySeat`. */
  turnLabels: string[];
  /** One hex colour per seat (no leading `#` needed — the widget tolerates both). */
  seatColors: string[];
  mySeat: number;
  roomCode: string;
  strings: {
    trains: string;
    score: string;
    lastRound: string;
    gameOver: string;
    waiting: string;
  };
}

/**
 * The mutable half. Must stay field-for-field identical to the Swift `ContentState` AND to the
 * server's `apnsLiveActivityBody` payload (apps/server/src/push/push.transports.ts) — the server
 * pushes this same shape as the APNs `content-state` while the app is suspended.
 */
export interface LiveActivityContent {
  /** Seat on the clock; -1 = nobody (game over / paused). */
  currentSeat: number;
  myTrains: number;
  myScore: number;
  /** Turns left in the final round; 0 = endgame not triggered. */
  finalTurnsRemaining: number;
  over: boolean;
  /** Epoch SECONDS the current turn lapses at (0 = no clock) — the widget's self-ticking countdown. */
  turnEndsAt: number;
}

interface NativeLiveActivityModule {
  areActivitiesEnabled(): boolean;
  start(attributes: LiveActivityAttributes, content: LiveActivityContent): Promise<string | null>;
  update(content: LiveActivityContent): Promise<boolean>;
  end(content: LiveActivityContent | null, dismissAfterSeconds: number): Promise<boolean>;
  addListener(
    event: 'onPushToken',
    listener: (payload: { token: string; activityId: string }) => void,
  ): NativeSubscription;
  addListener(
    event: 'onStateChange',
    listener: (payload: { state: LiveActivityState; activityId: string }) => void,
  ): NativeSubscription;
}

export type LiveActivityState = 'active' | 'ended' | 'dismissed' | 'stale' | 'unknown';

// `requireOptionalNativeModule` returns null when the module isn't in the binary — which is every
// non-iOS platform (the podspec is the only place it ships), plus the RNW harness.
const native: NativeLiveActivityModule | null =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<NativeLiveActivityModule>('TrmLiveActivity')
    : null;

/** True only where an activity could actually be started (iOS with the module linked). */
export const isLiveActivitySupported = (): boolean => native !== null;

/** False when the user turned Live Activities off for this app in iOS Settings. */
export const areLiveActivitiesEnabled = (): boolean => native?.areActivitiesEnabled() ?? false;

/** Start (or re-point) the activity; resolves the activity id, or null if the system refused. */
export const startLiveActivity = async (
  attributes: LiveActivityAttributes,
  content: LiveActivityContent,
): Promise<string | null> => (native ? native.start(attributes, content) : null);

/** Push new content; false when no activity is live. */
export const updateLiveActivity = async (content: LiveActivityContent): Promise<boolean> =>
  native ? native.update(content) : false;

/**
 * End the activity. `dismissAfterSeconds` keeps the final card up that long (game over is worth a
 * glance); 0 removes it at once (the player left the game).
 */
export const endLiveActivity = async (
  content: LiveActivityContent | null = null,
  dismissAfterSeconds = 0,
): Promise<boolean> => (native ? native.end(content, dismissAfterSeconds) : false);

/** ActivityKit push token updates — register these with the server so background turns keep flowing. */
export const addPushTokenListener = (listener: (token: string) => void): { remove: () => void } => {
  const sub = native?.addListener('onPushToken', ({ token }) => listener(token));
  return { remove: () => sub?.remove() };
};

/** Activity lifecycle (notably `dismissed`: the user swiped the card away). */
export const addStateListener = (
  listener: (state: LiveActivityState) => void,
): { remove: () => void } => {
  const sub = native?.addListener('onStateChange', ({ state }) => listener(state));
  return { remove: () => sub?.remove() };
};
