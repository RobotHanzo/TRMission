import { create } from 'zustand';
import type { UserFeature } from '@trm/shared';
import {
  api,
  setAccessToken,
  setOnTokenChange,
  type PublicUser,
  type UserPreferences,
} from '../net/rest';
import { clearRefreshToken, getRefreshToken } from '../net/secureStore';
import { registerDeviceForPush, unregisterDeviceForPush } from '../push/register';
import { useUi } from './ui';

/** How the current session was established — P5's account-deletion flow branches on `apple`. */
export type SignInMethod = 'guest' | 'password' | 'google' | 'apple' | 'discord';

interface SessionState {
  user: PublicUser | null;
  accessToken: string | null;
  signInMethod: SignInMethod | null;
  /** An auth action (login/register/guest/upgrade/oauth) is in flight. */
  loading: boolean;
  /** The initial "am I already logged in?" probe is running. */
  booting: boolean;
  error: string | null;
  restore(): Promise<void>;
  playAsGuest(name?: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  upgrade(email: string, password: string): Promise<void>;
  loginWithGoogleCredential(credential: string): Promise<void>;
  loginWithAppleCredential(identityToken: string, fullName?: string): Promise<void>;
  /** Complete the Discord handoff: redeem the one-time exchange code for a token pair. */
  loginWithDiscordExchange(code: string): Promise<void>;
  /** Persist display prefs to a registered account (guests stay AsyncStorage-only). */
  savePreferences(prefs: UserPreferences): Promise<void>;
  signOut(): Promise<void>;
  /** Drop the in-memory access token + keystore refresh token (P5 reuses on account deletion). */
  clearLocalSession(): Promise<void>;
  clearError(): void;
}

// Registered accounts are the source of truth for their own display prefs; on sign-in we adopt them
// into the ui store. Guests have no server-side prefs, so we leave the ui store on whatever it
// already loaded from AsyncStorage.
const hydratePrefs = (user: PublicUser | null): void => {
  if (user && !user.isGuest) useUi.getState().applyPreferences(user.preferences);
};

export const useSession = create<SessionState>()((set, get) => {
  setOnTokenChange((t) => set({ accessToken: t }));

  const run = async (
    method: SignInMethod,
    action: () => Promise<{ user: PublicUser }>,
  ): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const r = await action();
      set({ user: r.user, loading: false, signInMethod: method });
      hydratePrefs(r.user);
      // Register for push after a successful auth (fire-and-forget; never blocks sign-in).
      void registerDeviceForPush().catch(() => undefined);
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  };

  const clearLocalSession = async (): Promise<void> => {
    setAccessToken(null);
    await clearRefreshToken();
    set({ user: null, accessToken: null, signInMethod: null });
  };

  return {
    user: null,
    accessToken: null,
    signInMethod: null,
    loading: false,
    booting: true,
    error: null,
    // Resume a prior session. Mobile delta: the refresh token lives in the keystore, so a fast path
    // skips the network probe entirely when there is none (fresh install / signed out). When present,
    // api.me() restores the access token via the 401→refresh path (registered users *and* guests).
    async restore() {
      const token = await getRefreshToken();
      if (!token) {
        set({ booting: false });
        return;
      }
      try {
        const user = await api.me();
        set({ user, booting: false, signInMethod: user.isGuest ? 'guest' : get().signInMethod });
        hydratePrefs(user);
      } catch {
        await clearLocalSession();
        set({ booting: false });
      }
    },
    playAsGuest: (name) => run('guest', () => api.guest(name?.trim() || undefined)),
    login: (email, password) => run('password', () => api.login(email.trim(), password)),
    register: (email, password, displayName) =>
      run('password', () => api.register(email.trim(), password, displayName.trim())),
    upgrade: (email, password) => run('password', () => api.upgrade(email.trim(), password)),
    loginWithGoogleCredential: (credential) =>
      run('google', () => api.googleCredential(credential)),
    loginWithAppleCredential: (identityToken, fullName) =>
      run('apple', () => api.appleCredential(identityToken, fullName)),
    loginWithDiscordExchange: (code) => run('discord', () => api.mobileExchange(code)),
    async savePreferences(prefs) {
      const u = get().user;
      if (!u || u.isGuest) return; // guests persist via AsyncStorage only
      try {
        set({ user: await api.updatePreferences(prefs) });
      } catch {
        /* non-fatal: the ui store + AsyncStorage already hold the new value */
      }
    },
    async signOut() {
      // Clear local state synchronously first: navigation gates on `user`, so it must see the
      // signed-out state immediately — not after the network round-trip.
      set({ user: null, accessToken: null, signInMethod: null });
      // Unregister push before logout revokes the access token removeDevice needs.
      await unregisterDeviceForPush().catch(() => undefined);
      await api.logout().catch(() => undefined);
      await clearLocalSession();
    },
    clearLocalSession,
    clearError: () => set({ error: null }),
  };
});

/** Convenience selector: does the signed-in user hold a dashboard-granted feature? */
export const useHasFeature = (feature: UserFeature): boolean =>
  useSession((s) => !!s.user?.features?.includes(feature));
