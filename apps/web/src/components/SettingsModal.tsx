import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  Monitor,
  Sun,
  Moon,
  PanelRight,
  PanelBottom,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useUi } from '../store/ui';
import { useSession, useHasFeature } from '../store/session';
import { track } from '../lib/analytics';
import type { Theme, UserPreferences } from '../net/rest';
import type { BoardLayout, Locale } from '../store/ui';
import { Switch } from './ui/Switch';
import { Segmented } from './ui/Segmented';
import { VolumeSlider } from './ui/VolumeSlider';

interface Props {
  onClose(): void;
}

const THEME_OPTIONS: { value: Theme; icon: LucideIcon; labelKey: string }[] = [
  { value: 'system', icon: Monitor, labelKey: 'themeSystem' },
  { value: 'light', icon: Sun, labelKey: 'themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'themeDark' },
];

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'zh-Hant', label: '中文' },
  { value: 'en', label: 'English' },
];

const LAYOUT_OPTIONS: { value: BoardLayout; icon: LucideIcon; labelKey: string }[] = [
  { value: 'rail', icon: PanelRight, labelKey: 'layoutRail' },
  { value: 'tray', icon: PanelBottom, labelKey: 'layoutTray' },
];

export function SettingsModal({ onClose }: Props) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const theme = useUi((s) => s.theme);
  const colorBlind = useUi((s) => s.colorBlind);
  const boardLayout = useUi((s) => s.boardLayout);
  const setLocale = useUi((s) => s.setLocale);
  const setTheme = useUi((s) => s.setTheme);
  const setColorBlind = useUi((s) => s.setColorBlind);
  const setBoardLayout = useUi((s) => s.setBoardLayout);
  const soundEnabled = useUi((s) => s.soundEnabled);
  const soundVolume = useUi((s) => s.soundVolume);
  const setSoundEnabled = useUi((s) => s.setSoundEnabled);
  const setSoundVolume = useUi((s) => s.setSoundVolume);
  const hideAds = useUi((s) => s.hideAds);
  const setHideAds = useUi((s) => s.setHideAds);
  const savePreferences = useSession((s) => s.savePreferences);
  // The ad opt-out toggle only appears for accounts granted the `adFree` feature (from the
  // maintainer dashboard); AdSlot enforces the same feature check before honouring the preference.
  const canHideAds = useHasFeature('adFree');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Apply immediately for snappy feedback, then sync the full set to the account (no-op for
  // guests, who persist via localStorage only). Spreading the current values keeps every
  // preference in the synced payload while overriding just the one the user changed.
  const persist = (patch: Partial<UserPreferences>) =>
    void savePreferences({ theme, colorBlind, locale, boardLayout, ...patch });
  const chooseTheme = (next: Theme) => {
    setTheme(next);
    persist({ theme: next });
    track('settings_change', { setting: 'theme', value: next });
  };
  const chooseColorBlind = (next: boolean) => {
    setColorBlind(next);
    persist({ colorBlind: next });
    track('settings_change', { setting: 'colorblind', value: String(next) });
  };
  const chooseLocale = (next: Locale) => {
    setLocale(next);
    persist({ locale: next });
    track('settings_change', { setting: 'locale', value: next });
  };
  const chooseLayout = (next: BoardLayout) => {
    setBoardLayout(next);
    persist({ boardLayout: next });
    track('settings_change', { setting: 'board_layout', value: next });
  };
  const chooseSound = (next: boolean) => {
    setSoundEnabled(next);
    track('settings_change', { setting: 'sound', value: String(next) });
  };
  // Per-device only (localStorage, like sound) — not routed through savePreferences.
  const chooseHideAds = (next: boolean) => {
    setHideAds(next);
    track('settings_change', { setting: 'hide_ads', value: String(next) });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="settings-title">
            <Settings size={18} aria-hidden /> {t('settings')}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <section className="setting">
          <div className="setting-label">{t('appearance')}</div>
          <Segmented
            options={THEME_OPTIONS.map(({ value, icon, labelKey }) => ({
              value,
              label: t(labelKey),
              icon,
            }))}
            value={theme}
            onChange={chooseTheme}
            ariaLabel={t('appearance')}
          />
        </section>

        <section className="setting">
          <div className="setting-label">{t('language')}</div>
          <Segmented
            options={LOCALE_OPTIONS.map(({ value, label }) => ({ value, label }))}
            value={locale}
            onChange={chooseLocale}
            ariaLabel={t('language')}
          />
        </section>

        <section className="setting">
          <div className="setting-label">{t('layout')}</div>
          <Segmented
            options={LAYOUT_OPTIONS.map(({ value, icon, labelKey }) => ({
              value,
              label: t(labelKey),
              icon,
            }))}
            value={boardLayout}
            onChange={chooseLayout}
            ariaLabel={t('layout')}
          />
        </section>

        <section className="setting setting-row">
          <div>
            <div className="setting-label">{t('colorBlind')}</div>
            <div className="muted setting-desc">{t('colorBlindDesc')}</div>
          </div>
          <Switch checked={colorBlind} onChange={chooseColorBlind} label={t('colorBlind')} />
        </section>

        <section className="setting setting-row">
          <div>
            <div className="setting-label">{t('sound')}</div>
            <VolumeSlider
              value={soundVolume}
              enabled={soundEnabled}
              onChangeValue={setSoundVolume}
              onToggleEnabled={chooseSound}
              rangeLabel={t('volume')}
              muteLabel={t('sound')}
            />
          </div>
          <Switch checked={soundEnabled} onChange={chooseSound} label={t('sound')} />
        </section>

        {canHideAds && (
          <section className="setting setting-row">
            <div>
              <div className="setting-label">{t('hideAds')}</div>
              <div className="muted setting-desc">{t('hideAdsDesc')}</div>
            </div>
            <Switch checked={hideAds} onChange={chooseHideAds} label={t('hideAds')} />
          </section>
        )}
      </div>
    </div>
  );
}
