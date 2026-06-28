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
import { useSession } from '../store/session';
import type { Theme, UserPreferences } from '../net/rest';
import type { BoardLayout, Locale } from '../store/ui';

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
  const savePreferences = useSession((s) => s.savePreferences);

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
  };
  const chooseColorBlind = (next: boolean) => {
    setColorBlind(next);
    persist({ colorBlind: next });
  };
  const chooseLocale = (next: Locale) => {
    setLocale(next);
    persist({ locale: next });
  };
  const chooseLayout = (next: BoardLayout) => {
    setBoardLayout(next);
    persist({ boardLayout: next });
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
          <div className="segmented" role="radiogroup" aria-label={t('appearance')}>
            {THEME_OPTIONS.map(({ value, icon: Icon, labelKey }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                className={theme === value ? 'segment active' : 'segment'}
                onClick={() => chooseTheme(value)}
              >
                <Icon size={16} aria-hidden />
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="setting">
          <div className="setting-label">{t('language')}</div>
          <div className="segmented" role="radiogroup" aria-label={t('language')}>
            {LOCALE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={locale === value}
                className={locale === value ? 'segment active' : 'segment'}
                onClick={() => chooseLocale(value)}
              >
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="setting">
          <div className="setting-label">{t('layout')}</div>
          <div className="segmented" role="radiogroup" aria-label={t('layout')}>
            {LAYOUT_OPTIONS.map(({ value, icon: Icon, labelKey }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={boardLayout === value}
                className={boardLayout === value ? 'segment active' : 'segment'}
                onClick={() => chooseLayout(value)}
              >
                <Icon size={16} aria-hidden />
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="setting setting-row">
          <div>
            <div className="setting-label">{t('colorBlind')}</div>
            <div className="muted setting-desc">{t('colorBlindDesc')}</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={colorBlind}
            aria-label={t('colorBlind')}
            className={colorBlind ? 'switch on' : 'switch'}
            onClick={() => chooseColorBlind(!colorBlind)}
          >
            <span className="switch-knob" />
          </button>
        </section>
      </div>
    </div>
  );
}
