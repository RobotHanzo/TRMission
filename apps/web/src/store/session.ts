import { create } from 'zustand';
import { api, setOnTokenChange, type PublicUser } from '../net/rest';

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
  register(email: string, password: string, displayName: string): Promise<void>;
  upgrade(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  clearError(): void;
}

export const useSession = create<SessionState>()((set) => {
  setOnTokenChange((t) => set({ accessToken: t }));

  const run = async (action: () => Promise<{ user: PublicUser }>): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const r = await action();
      set({ user: r.user, loading: false });
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
      } catch {
        set({ user: null, booting: false });
      }
    },
    playAsGuest: (name) => run(() => api.guest(name?.trim() || undefined)),
    login: (email, password) => run(() => api.login(email.trim(), password)),
    register: (email, password, displayName) =>
      run(() => api.register(email.trim(), password, displayName.trim())),
    upgrade: (email, password) => run(() => api.upgrade(email.trim(), password)),
    async logout() {
      await api.logout().catch(() => undefined);
      set({ user: null, accessToken: null });
    },
    clearError: () => set({ error: null }),
  };
});
