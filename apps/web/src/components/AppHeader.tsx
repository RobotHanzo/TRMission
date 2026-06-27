import { useTranslation } from 'react-i18next';
import { TrainFront, Eye } from 'lucide-react';
import { useUi } from '../store/ui';

export function AppHeader() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const setLocale = useUi((s) => s.setLocale);
  const colorBlind = useUi((s) => s.colorBlind);
  const toggleColorBlind = useUi((s) => s.toggleColorBlind);

  return (
    <header className="app-header">
      <div className="brand">
        <TrainFront size={22} aria-hidden />
        <strong>{t('appName')}</strong>
      </div>
      <div className="header-actions">
        <button
          onClick={() => setLocale(locale === 'zh-Hant' ? 'en' : 'zh-Hant')}
          aria-label={t('language')}
        >
          {locale === 'zh-Hant' ? 'EN' : '中'}
        </button>
        <button onClick={toggleColorBlind} aria-pressed={colorBlind} title={t('colorBlind')}>
          <Eye size={16} aria-hidden />
        </button>
      </div>
    </header>
  );
}
