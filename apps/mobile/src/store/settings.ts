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
  setHaptics(v: boolean): void;
  setNotifications(v: boolean): void;
  markPushPromptSeen(): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      haptics: true,
      notifications: false,
      pushPromptSeen: false,
      setHaptics: (haptics) => set({ haptics }),
      setNotifications: (notifications) => set({ notifications }),
      markPushPromptSeen: () => set({ pushPromptSeen: true }),
    }),
    { name: 'trm-settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
