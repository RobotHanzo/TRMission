import { create } from 'zustand';
import { api, setOnTokenChange, type PublicUser } from '../net/rest';

interface SessionState {
  user: PublicUser | null;
  accessToken: string | null;
  loading: boolean;
  error: string | null;
  playAsGuest(name?: string): Promise<void>;
  logout(): Promise<void>;
}

export const useSession = create<SessionState>()((set) => {
  setOnTokenChange((t) => set({ accessToken: t }));
  return {
    user: null,
    accessToken: null,
    loading: false,
    error: null,
    async playAsGuest(name) {
      set({ loading: true, error: null });
      try {
        const r = await api.guest(name?.trim() || undefined);
        set({ user: r.user, accessToken: r.accessToken, loading: false });
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },
    async logout() {
      await api.logout().catch(() => undefined);
      set({ user: null, accessToken: null });
    },
  };
});
