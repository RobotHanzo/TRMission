import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device-local preferences (NOT account preferences — those live on the server via
 * PATCH /auth/me/preferences). Haptics/notifications are per-device by nature.
 */
interface SettingsState {
  /** Haptic feedback on game beats (route claim, tunnel reveal, ticket completion, game end). */
  haptics: boolean;
  /** User intent for push. Actual delivery also needs OS permission + a registered token. */
  notifications: boolean;
  /** The contextual post-first-game permission prompt fires at most once. */
  pushPromptSeen: boolean;
  /** iOS Live Activity for the game in progress (lock screen + Dynamic Island). Needs no OS
   *  permission — it is on unless the user turns Live Activities off for the app in Settings — so
   *  unlike `notifications` it defaults ON, and this flag is the in-app opt-out. */
  liveActivities: boolean;
  setHaptics(v: boolean): void;
  setNotifications(v: boolean): void;
  markPushPromptSeen(): void;
  setLiveActivities(v: boolean): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      haptics: true,
      notifications: false,
      pushPromptSeen: false,
      liveActivities: true,
      setHaptics: (haptics) => set({ haptics }),
      setNotifications: (notifications) => set({ notifications }),
      markPushPromptSeen: () => set({ pushPromptSeen: true }),
      setLiveActivities: (liveActivities) => set({ liveActivities }),
    }),
    { name: 'trm-settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
