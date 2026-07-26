import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device-local preferences (NOT account preferences — those live on the server via
 * PATCH /auth/me/preferences). Haptics/notifications are per-device by nature.
 */
interface SettingsState {
  /** Haptic feedback: the game beats (route claim, tunnel reveal, ticket completion, game end)
   *  and the pull-to-refresh drag (issue #61) — one switch for everything that vibrates. */
  haptics: boolean;
  /** User intent for push. Actual delivery also needs OS permission + a registered token. */
  notifications: boolean;
  /** Hold back push notifications while the app is open — deliver only once the player is away
   *  (issue #48). Defaults ON: a banner about a game you are sitting in front of is noise. The
   *  rule is applied by the foreground handler in `../push/notifications.ts`. */
  notifyOnlyWhenAway: boolean;
  /** The contextual post-first-game permission prompt fires at most once. */
  pushPromptSeen: boolean;
  /** iOS Live Activity for the game in progress (lock screen + Dynamic Island). Needs no OS
   *  permission — it is on unless the user turns Live Activities off for the app in Settings — so
   *  unlike `notifications` it defaults ON, and this flag is the in-app opt-out. */
  liveActivities: boolean;
  setHaptics(v: boolean): void;
  setNotifications(v: boolean): void;
  setNotifyOnlyWhenAway(v: boolean): void;
  markPushPromptSeen(): void;
  setLiveActivities(v: boolean): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      haptics: true,
      notifications: false,
      notifyOnlyWhenAway: true,
      pushPromptSeen: false,
      liveActivities: true,
      setHaptics: (haptics) => set({ haptics }),
      setNotifications: (notifications) => set({ notifications }),
      setNotifyOnlyWhenAway: (notifyOnlyWhenAway) => set({ notifyOnlyWhenAway }),
      markPushPromptSeen: () => set({ pushPromptSeen: true }),
      setLiveActivities: (liveActivities) => set({ liveActivities }),
    }),
    { name: 'trm-settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
