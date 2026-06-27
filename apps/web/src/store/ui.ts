import { create } from 'zustand';
import type { Theme, UserPreferences } from '../net/rest';

export type View = 'home' | 'room' | 'game';
export type Locale = 'zh-Hant' | 'en';

const THEME_KEY = 'trm.theme';
const COLOR_BLIND_KEY = 'trm.colorBlind';
const LOCALE_KEY = 'trm.locale';
const THEMES: Theme[] = ['system', 'light', 'dark'];
const LOCALES: Locale[] = ['zh-Hant', 'en'];

const readTheme = (): Theme => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v && (THEMES as string[]).includes(v) ? (v as Theme) : 'system';
  } catch {
    return 'system';
  }
};
const readLocale = (): Locale => {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return v && (LOCALES as string[]).includes(v) ? (v as Locale) : 'zh-Hant';
  } catch {
    return 'zh-Hant';
  }
};
const readColorBlind = (): boolean => {
  try {
    return localStorage.getItem(COLOR_BLIND_KEY) === '1';
  } catch {
    return false;
  }
};
const writeLocal = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — keep the value in memory only */
  }
};

interface UiState {
  view: View;
  roomCode: string | null;
  gameId: string | null;
  ticket: string | null;
  locale: Locale;
  theme: Theme;
  colorBlind: boolean;
  goHome(): void;
  enterRoom(code: string): void;
  enterGame(gameId: string, ticket: string): void;
  setLocale(locale: Locale): void;
  setTheme(theme: Theme): void;
  setColorBlind(colorBlind: boolean): void;
  /** Adopt preferences from a signed-in account (the account is the source of truth). */
  applyPreferences(prefs: UserPreferences): void;
}

export const useUi = create<UiState>()((set) => ({
  view: 'home',
  roomCode: null,
  gameId: null,
  ticket: null,
  // Seed display prefs from localStorage so guests (and the pre-/auth/me window) persist them.
  locale: readLocale(),
  theme: readTheme(),
  colorBlind: readColorBlind(),
  goHome: () => set({ view: 'home', roomCode: null, gameId: null, ticket: null }),
  enterRoom: (code) => set({ view: 'room', roomCode: code }),
  enterGame: (gameId, ticket) => set({ view: 'game', gameId, ticket }),
  setLocale: (locale) => {
    writeLocal(LOCALE_KEY, locale);
    set({ locale });
  },
  setTheme: (theme) => {
    writeLocal(THEME_KEY, theme);
    set({ theme });
  },
  setColorBlind: (colorBlind) => {
    writeLocal(COLOR_BLIND_KEY, colorBlind ? '1' : '0');
    set({ colorBlind });
  },
  applyPreferences: (prefs) => {
    writeLocal(THEME_KEY, prefs.theme);
    writeLocal(COLOR_BLIND_KEY, prefs.colorBlind ? '1' : '0');
    set({ theme: prefs.theme, colorBlind: prefs.colorBlind });
  },
}));
