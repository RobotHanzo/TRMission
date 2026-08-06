import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { DEFAULT_TRAIN_CAR_SKIN, TRAIN_CAR_SKINS, type TrainCarSkin } from '@trm/shared';
import i18n from '../i18n';
import type { BoardLayout, Locale, Theme, UserPreferences } from '../net/rest';

// A slimmed port of the web ui store: display preferences only, backed by AsyncStorage instead of
// synchronous localStorage. Routing/layout orchestration is P2's concern. Because AsyncStorage is
// async, the store starts with defaults and `hydrate()` (called once on boot) loads persisted values.
const THEME_KEY = 'trm.theme';
const LOCALE_KEY = 'trm.locale';
const COLOR_BLIND_KEY = 'trm.colorBlind';
const BOARD_LAYOUT_KEY = 'trm.boardLayout';
const TRAIN_CAR_SKIN_KEY = 'trm.trainCarSkin';
const FOLLOW_ACTING_KEY = 'trm.followActing';
const SOUND_ENABLED_KEY = 'trm.soundEnabled';
const SOUND_VOLUME_KEY = 'trm.soundVolume';
const HIDE_ADS_KEY = 'trm.hideAds';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
const LOCALES: readonly Locale[] = ['zh-Hant', 'en'];
const BOARD_LAYOUTS: readonly BoardLayout[] = ['rail', 'tray'];
const SKINS: readonly TrainCarSkin[] = TRAIN_CAR_SKINS;
const oneOf = <T extends string>(vals: readonly T[], v: string | null, fallback: T): T =>
  v && (vals as readonly string[]).includes(v) ? (v as T) : fallback;

interface UiState {
  theme: Theme;
  locale: Locale;
  colorBlind: boolean;
  boardLayout: BoardLayout;
  /** Train-card artwork pack. Account-synced like the other display prefs; what actually gets
   *  drawn is `resolveTrainCarSkin(trainCarSkin, availableTrainCarSkins)` — see `useTrainCarSkin`. */
  trainCarSkin: TrainCarSkin;
  /** The packs a maintainer currently offers (`GET /skins/train-cars/enabled`); null until the
   *  list arrives or if the request failed — treated as "offer everything this build bundles". */
  availableTrainCarSkins: TrainCarSkin[] | null;
  /** "Follow the acting player" camera toggle (ports web store/ui.ts followActing; used in P2 Task 5). */
  followActing: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  /** Ad opt-out — per-device (AsyncStorage only, never account-synced), ported from web's ui store.
   *  The toggle that sets it is gated behind the `adFree` account feature and `useAdsVisible` only
   *  honours it for accounts that hold that feature, so a stray stored flag can't suppress ads. */
  hideAds: boolean;
  /** True once AsyncStorage has been read on boot. */
  hydrated: boolean;
  hydrate(): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
  setLocale(locale: Locale): Promise<void>;
  setColorBlind(colorBlind: boolean): Promise<void>;
  setBoardLayout(boardLayout: BoardLayout): Promise<void>;
  setTrainCarSkin(trainCarSkin: TrainCarSkin): Promise<void>;
  setAvailableTrainCarSkins(skins: TrainCarSkin[] | null): void;
  setFollowActing(followActing: boolean): Promise<void>;
  setSoundEnabled(soundEnabled: boolean): Promise<void>;
  setSoundVolume(soundVolume: number): Promise<void>;
  setHideAds(hideAds: boolean): Promise<void>;
  /** Adopt a registered account's server-side prefs on sign-in. */
  applyPreferences(prefs: UserPreferences): void;
}

export const useUi = create<UiState>()((set) => ({
  theme: 'system',
  locale: 'zh-Hant',
  colorBlind: false,
  boardLayout: 'rail',
  trainCarSkin: DEFAULT_TRAIN_CAR_SKIN,
  availableTrainCarSkins: null,
  followActing: true,
  soundEnabled: true,
  soundVolume: 0.6,
  hideAds: false,
  hydrated: false,
  async hydrate() {
    try {
      const [
        theme,
        locale,
        colorBlind,
        boardLayout,
        trainCarSkin,
        followActing,
        soundEnabled,
        soundVolume,
        hideAds,
      ] = await AsyncStorage.multiGet([
        THEME_KEY,
        LOCALE_KEY,
        COLOR_BLIND_KEY,
        BOARD_LAYOUT_KEY,
        TRAIN_CAR_SKIN_KEY,
        FOLLOW_ACTING_KEY,
        SOUND_ENABLED_KEY,
        SOUND_VOLUME_KEY,
        HIDE_ADS_KEY,
      ]);
      const nextLocale = oneOf(LOCALES, locale[1], 'zh-Hant');
      const vol = soundVolume[1] != null ? Number(soundVolume[1]) : NaN;
      set({
        theme: oneOf(THEMES, theme[1], 'system'),
        locale: nextLocale,
        colorBlind: colorBlind[1] === '1',
        boardLayout: oneOf(BOARD_LAYOUTS, boardLayout[1], 'rail'),
        trainCarSkin: oneOf(SKINS, trainCarSkin[1], DEFAULT_TRAIN_CAR_SKIN),
        followActing: followActing[1] == null ? true : followActing[1] === '1',
        soundEnabled: soundEnabled[1] == null ? true : soundEnabled[1] === '1',
        soundVolume: Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0.6,
        hideAds: hideAds[1] === '1',
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
  async setTrainCarSkin(trainCarSkin) {
    set({ trainCarSkin });
    await AsyncStorage.setItem(TRAIN_CAR_SKIN_KEY, trainCarSkin).catch(() => undefined);
  },
  setAvailableTrainCarSkins(availableTrainCarSkins) {
    set({ availableTrainCarSkins });
  },
  async setFollowActing(followActing) {
    set({ followActing });
    await AsyncStorage.setItem(FOLLOW_ACTING_KEY, followActing ? '1' : '0').catch(() => undefined);
  },
  async setSoundEnabled(soundEnabled) {
    set({ soundEnabled });
    await AsyncStorage.setItem(SOUND_ENABLED_KEY, soundEnabled ? '1' : '0').catch(() => undefined);
  },
  async setSoundVolume(v) {
    const soundVolume = Math.max(0, Math.min(1, v));
    set({ soundVolume });
    await AsyncStorage.setItem(SOUND_VOLUME_KEY, String(soundVolume)).catch(() => undefined);
  },
  async setHideAds(hideAds) {
    set({ hideAds });
    await AsyncStorage.setItem(HIDE_ADS_KEY, hideAds ? '1' : '0').catch(() => undefined);
  },
  applyPreferences(prefs) {
    // A server built before this preference existed omits it — keep whatever is stored on the
    // device rather than snapping the card art back to the default on every sign-in.
    const trainCarSkin = prefs.trainCarSkin ?? useUi.getState().trainCarSkin;
    set({
      theme: prefs.theme,
      locale: prefs.locale,
      colorBlind: prefs.colorBlind,
      boardLayout: prefs.boardLayout,
      trainCarSkin,
    });
    void i18n.changeLanguage(prefs.locale);
    void AsyncStorage.multiSet([
      [THEME_KEY, prefs.theme],
      [LOCALE_KEY, prefs.locale],
      [COLOR_BLIND_KEY, prefs.colorBlind ? '1' : '0'],
      [BOARD_LAYOUT_KEY, prefs.boardLayout],
      [TRAIN_CAR_SKIN_KEY, trainCarSkin],
    ]).catch(() => undefined);
  },
}));
