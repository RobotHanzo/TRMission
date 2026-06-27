import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrainFront, Settings, LogOut, User } from 'lucide-react';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { SettingsModal } from './SettingsModal';

export function AppHeader() {
  const { t } = useTranslation();
  const goHome = useUi((s) => s.goHome);
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
          onClick={() => setSettingsOpen(true)}
          aria-label={t('settings')}
          title={t('settings')}
        >
          <Settings size={16} aria-hidden />
        </button>
        {user && (
          <button onClick={onLogout} aria-label={t('logout')} title={t('logout')}>
            <LogOut size={16} aria-hidden />
          </button>
        )}
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
