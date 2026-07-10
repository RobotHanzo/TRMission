import { create } from 'zustand';
import type { UserFeature } from '@trm/shared';
import { api, setOnTokenChange, type PublicUser, type UserPreferences } from '../net/rest';
import { useUi } from './ui';
import { track } from '../lib/analytics';

interface SessionState {
  user: PublicUser | null;
  accessToken: string | null;
  /** An auth action (login/register/guest/upgrade) is in flight. */
  loading: boolean;
  /** The initial "am I already logged in?" probe is running. */
  booting: boolean;
  error: string | null;
  restore(): Promise<void>;
  playAsGuest(name?: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  loginWithGoogleCredential(credential: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  upgrade(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** Persist display prefs to the account for registered users (guests stay localStorage-only). */
  savePreferences(prefs: UserPreferences): Promise<void>;
  /** Mark the guided tutorial as completed (called from the tutorial finale). Non-fatal on failure
   *  — a failed write just means the welcome-screen recommendation shows up again next time. */
  completeTutorial(): Promise<void>;
  clearError(): void;
}

// Registered accounts are the source of truth for their own display prefs; on sign-in we
// adopt them into the ui store. Guests have no server-side prefs, so we leave the ui store
// on whatever it already loaded from localStorage.
const hydratePrefs = (user: PublicUser | null): void => {
  if (user && !user.isGuest) useUi.getState().applyPreferences(user.preferences);
};

export const useSession = create<SessionState>()((set, get) => {
  setOnTokenChange((t) => set({ accessToken: t }));

  const run = async (
    action: () => Promise<{ user: PublicUser }>,
    onSuccess?: () => void,
  ): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const r = await action();
      set({ user: r.user, loading: false });
      hydratePrefs(r.user);
      onSuccess?.();
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  };

  return {
    user: null,
    accessToken: null,
    loading: false,
    booting: true,
    error: null,
    // Resume a prior session from the refresh cookie (registered users *and* guests stay
    // logged in across reloads); the access token is restored via the 401→refresh path.
    async restore() {
      try {
        const user = await api.me();
        set({ user, booting: false });
        hydratePrefs(user);
      } catch {
        set({ user: null, booting: false });
      }
    },
    playAsGuest: (name) =>
      run(() => api.guest(name?.trim() || undefined), () => track('login', { method: 'guest' })),
    login: (email, password) =>
      run(() => api.login(email.trim(), password), () => track('login', { method: 'password' })),
    loginWithGoogleCredential: (credential) =>
      run(() => api.googleCredential(credential), () => track('login', { method: 'google' })),
    register: (email, password, displayName) =>
      run(
        () => api.register(email.trim(), password, displayName.trim()),
        () => track('sign_up', { method: 'password' }),
      ),
    upgrade: (email, password) =>
      run(() => api.upgrade(email.trim(), password), () => track('guest_upgrade', {})),
    async logout() {
      // Clear local session state SYNCHRONOUSLY first: the login route's auto-redirect gates on
      // `user`, so it must see the signed-out state immediately — not after the network round-trip
      // (otherwise it briefly treats the user as still logged in and lands them on a blank home).
      set({ user: null, accessToken: null });
      track('logout', {});
      await api.logout().catch(() => undefined);
    },
    async savePreferences(prefs) {
      const u = get().user;
      if (!u || u.isGuest) return; // guests + anonymous persist via localStorage only
      try {
        set({ user: await api.updatePreferences(prefs) });
      } catch {
        /* non-fatal: the ui store + localStorage already hold the new value */
      }
    },
    async completeTutorial() {
      try {
        set({ user: await api.markTutorialCompleted() });
      } catch {
        /* non-fatal: popup just keeps recommending the tutorial next time */
      }
    },
    clearError: () => set({ error: null }),
  };
});

/** Convenience selector: does the signed-in user hold a dashboard-granted feature? */
export const useHasFeature = (feature: UserFeature): boolean =>
  useSession((s) => !!s.user?.features?.includes(feature));
