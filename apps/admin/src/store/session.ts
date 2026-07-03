// Auth/session for the dashboard: the existing game accounts sign in here, but only
// accounts with a dashboardAccounts record get past the gate. Phases:
//   booting → unauthenticated | denied | ready
// `denied` means the login IS valid as a game session (the cookie is shared) — the
// DeniedView says so plainly and offers logout.
import { create } from 'zustand';
import type { DashboardPermission, DashboardRole } from '@trm/shared';
import { api, ApiError, setOnTokenChange, type PublicUser } from '../net/rest';
import { gateToLogin, leaveLogin } from './ui';

export type SessionPhase = 'booting' | 'unauthenticated' | 'denied' | 'ready';

interface SessionState {
  phase: SessionPhase;
  user: PublicUser | null;
  role: DashboardRole | null;
  permissions: Set<DashboardPermission>;
  loading: boolean;
  error: string | null;
  restore(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  hasPermission(p: DashboardPermission): boolean;
}

async function probeDashboard(
  user: PublicUser,
): Promise<Pick<SessionState, 'phase' | 'user' | 'role' | 'permissions'>> {
  if (user.isGuest) {
    return { phase: 'denied', user, role: null, permissions: new Set() };
  }
  try {
    const me = await api.dashboardMe();
    return { phase: 'ready', user, role: me.role, permissions: new Set(me.permissions) };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      return { phase: 'denied', user, role: null, permissions: new Set() };
    }
    throw e;
  }
}

export const useSession = create<SessionState>()((set, get) => ({
  phase: 'booting',
  user: null,
  role: null,
  permissions: new Set<DashboardPermission>(),
  loading: false,
  error: null,

  async restore() {
    setOnTokenChange(() => {});
    try {
      const user = await api.me(); // 401 → single silent refresh via the shared cookie
      const next = await probeDashboard(user);
      set(next);
      if (next.phase === 'ready') leaveLogin();
      else if (next.phase === 'denied') gateToLogin();
    } catch {
      set({ phase: 'unauthenticated', user: null, role: null, permissions: new Set() });
      gateToLogin();
    }
  },

  async login(email, password) {
    set({ loading: true, error: null });
    try {
      const result = await api.login(email, password);
      const next = await probeDashboard(result.user);
      set({ ...next, loading: false });
      if (next.phase === 'ready') leaveLogin();
    } catch (e) {
      set({
        loading: false,
        error: e instanceof ApiError ? e.message : 'network error',
      });
    }
  },

  async logout() {
    try {
      await api.logout();
    } catch {
      /* cookie may already be gone */
    }
    set({ phase: 'unauthenticated', user: null, role: null, permissions: new Set() });
    gateToLogin();
  },

  hasPermission(p) {
    return get().permissions.has(p);
  },
}));
