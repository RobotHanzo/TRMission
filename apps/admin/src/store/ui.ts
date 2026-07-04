// Hand-rolled router + display prefs (the game web app's store/ui.ts pattern, smaller).
// All paths live under the /admin base (vite `base: '/admin/'`; nginx serves the same).
import { create } from 'zustand';
import i18n from '../i18n';

export type AdminView =
  | 'overview'
  | 'users'
  | 'features'
  | 'games'
  | 'rooms'
  | 'maintainers'
  | 'audit';

export type AdminTheme = 'dark' | 'light';
export type AdminLocale = 'zh-Hant' | 'en';

const BASE = '/admin';
const THEME_KEY = 'trm.admin.theme';
const LOCALE_KEY = 'trm.admin.locale';

/** /admin/users/abc → { view: 'users', param: 'abc' }. Unknown paths → overview. */
export function parsePath(pathname: string): { view: AdminView; param: string | null } {
  let p = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  if (!p.startsWith('/')) p = `/${p}`;
  const m = /^\/(users|features|games|rooms|maintainers|audit)(?:\/([^/]+))?\/?$/.exec(p);
  if (m) return { view: m[1] as AdminView, param: m[2] ? decodeURIComponent(m[2]) : null };
  return { view: 'overview', param: null };
}

export function pathFor(view: AdminView, param?: string | null): string {
  if (view === 'overview') return `${BASE}/`;
  if (param) return `${BASE}/${view}/${encodeURIComponent(param)}`;
  return `${BASE}/${view}`;
}

const pushPath = (path: string): void => {
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
};

const readTheme = (): AdminTheme => {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};
const readLocale = (): AdminLocale => {
  try {
    return localStorage.getItem(LOCALE_KEY) === 'en' ? 'en' : 'zh-Hant';
  } catch {
    return 'zh-Hant';
  }
};

const applyTheme = (theme: AdminTheme): void => {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable */
  }
};

interface UiState {
  view: AdminView;
  /** Detail id for users/games (a drawer over the list). */
  param: string | null;
  theme: AdminTheme;
  locale: AdminLocale;
  navigate(view: AdminView, param?: string | null): void;
  /** Detail drawers push their id into the URL so refresh/share lands back on them. */
  openDetail(view: 'users' | 'games', id: string): void;
  closeDetail(): void;
  syncFromUrl(): void;
  setTheme(theme: AdminTheme): void;
  toggleTheme(): void;
  setLocale(locale: AdminLocale): void;
}

export const useUi = create<UiState>()((set, get) => ({
  ...parsePath(window.location.pathname),
  theme: readTheme(),
  locale: readLocale(),

  navigate(view, param = null) {
    pushPath(pathFor(view, param));
    set({ view, param });
  },
  openDetail(view, id) {
    pushPath(pathFor(view, id));
    set({ view, param: id });
  },
  closeDetail() {
    const { view } = get();
    if (view === 'users' || view === 'games') {
      pushPath(pathFor(view));
      set({ param: null });
    }
  },
  syncFromUrl() {
    set(parsePath(window.location.pathname));
  },
  setTheme(theme) {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme() {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
  setLocale(locale) {
    void i18n.changeLanguage(locale);
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* storage unavailable */
    }
    set({ locale });
  },
}));
