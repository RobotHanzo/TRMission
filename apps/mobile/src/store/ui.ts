import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import i18n from '../i18n';
import type { BoardLayout, Locale, Theme, UserPreferences } from '../net/rest';

// A slimmed port of the web ui store: display preferences only, backed by AsyncStorage instead of
// synchronous localStorage. Routing/layout orchestration is P2's concern. Because AsyncStorage is
// async, the store starts with defaults and `hydrate()` (called once on boot) loads persisted values.
const THEME_KEY = 'trm.theme';
const LOCALE_KEY = 'trm.locale';
const COLOR_BLIND_KEY = 'trm.colorBlind';
const BOARD_LAYOUT_KEY = 'trm.boardLayout';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
const LOCALES: readonly Locale[] = ['zh-Hant', 'en'];
const BOARD_LAYOUTS: readonly BoardLayout[] = ['rail', 'tray'];
const oneOf = <T extends string>(vals: readonly T[], v: string | null, fallback: T): T =>
  v && (vals as readonly string[]).includes(v) ? (v as T) : fallback;

interface UiState {
  theme: Theme;
  locale: Locale;
  colorBlind: boolean;
  boardLayout: BoardLayout;
  /** True once AsyncStorage has been read on boot. */
  hydrated: boolean;
  hydrate(): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
  setLocale(locale: Locale): Promise<void>;
  setColorBlind(colorBlind: boolean): Promise<void>;
  setBoardLayout(boardLayout: BoardLayout): Promise<void>;
  /** Adopt a registered account's server-side prefs on sign-in. */
  applyPreferences(prefs: UserPreferences): void;
}

export const useUi = create<UiState>()((set) => ({
  theme: 'system',
  locale: 'zh-Hant',
  colorBlind: false,
  boardLayout: 'rail',
  hydrated: false,
  async hydrate() {
    try {
      const [theme, locale, colorBlind, boardLayout] = await AsyncStorage.multiGet([
        THEME_KEY,
        LOCALE_KEY,
        COLOR_BLIND_KEY,
        BOARD_LAYOUT_KEY,
      ]);
      const nextLocale = oneOf(LOCALES, locale[1], 'zh-Hant');
      set({
        theme: oneOf(THEMES, theme[1], 'system'),
        locale: nextLocale,
        colorBlind: colorBlind[1] === '1',
        boardLayout: oneOf(BOARD_LAYOUTS, boardLayout[1], 'rail'),
        hydrated: true,
      });
      if (i18n.language !== nextLocale) await i18n.changeLanguage(nextLocale);
    } catch {
      set({ hydrated: true });
    }
  },
  async setTheme(theme) {
    set({ theme });
    await AsyncStorage.setItem(THEME_KEY, theme).catch(() => undefined);
  },
  async setLocale(locale) {
    set({ locale });
    await i18n.changeLanguage(locale);
    await AsyncStorage.setItem(LOCALE_KEY, locale).catch(() => undefined);
  },
  async setColorBlind(colorBlind) {
    set({ colorBlind });
    await AsyncStorage.setItem(COLOR_BLIND_KEY, colorBlind ? '1' : '0').catch(() => undefined);
  },
  async setBoardLayout(boardLayout) {
    set({ boardLayout });
    await AsyncStorage.setItem(BOARD_LAYOUT_KEY, boardLayout).catch(() => undefined);
  },
  applyPreferences(prefs) {
    set({
      theme: prefs.theme,
      locale: prefs.locale,
      colorBlind: prefs.colorBlind,
      boardLayout: prefs.boardLayout,
    });
    void i18n.changeLanguage(prefs.locale);
    void AsyncStorage.multiSet([
      [THEME_KEY, prefs.theme],
      [LOCALE_KEY, prefs.locale],
      [COLOR_BLIND_KEY, prefs.colorBlind ? '1' : '0'],
      [BOARD_LAYOUT_KEY, prefs.boardLayout],
    ]).catch(() => undefined);
  },
}));
