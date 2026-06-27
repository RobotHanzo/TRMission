import { useTranslation } from 'react-i18next';
import { TrainFront, Eye, LogOut, User } from 'lucide-react';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';

export function AppHeader() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const setLocale = useUi((s) => s.setLocale);
  const goHome = useUi((s) => s.goHome);
  const colorBlind = useUi((s) => s.colorBlind);
  const toggleColorBlind = useUi((s) => s.toggleColorBlind);
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);

  const onLogout = () => {
    void logout();
    goHome();
  };

  return (
    <header className="app-header">
      <div className="brand">
        <TrainFront size={22} aria-hidden />
        <strong>{t('appName')}</strong>
      </div>
      <div className="header-actions">
        {user && (
          <span className="user-chip" title={user.isGuest ? t('guest') : (user.email ?? '')}>
            <User size={14} aria-hidden /> {user.displayName}
          </span>
        )}
        <button
          onClick={() => setLocale(locale === 'zh-Hant' ? 'en' : 'zh-Hant')}
          aria-label={t('language')}
        >
          {locale === 'zh-Hant' ? 'EN' : '中'}
        </button>
        <button onClick={toggleColorBlind} aria-pressed={colorBlind} title={t('colorBlind')}>
          <Eye size={16} aria-hidden />
        </button>
        {user && (
          <button onClick={onLogout} aria-label={t('logout')} title={t('logout')}>
            <LogOut size={16} aria-hidden />
          </button>
        )}
      </div>
    </header>
  );
}
