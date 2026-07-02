import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrainFront, Settings, LogOut, DoorOpen, User, BookOpen, History } from 'lucide-react';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { useGame } from '../store/game';
import { turnStatus } from '../game/view';
import { usePlayerName } from '../game/playerName';
import { SettingsModal } from './SettingsModal';

export function AppHeader() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const goHome = useUi((s) => s.goHome);
  const enterHistory = useUi((s) => s.enterHistory);
  const navigateLogin = useUi((s) => s.navigateLogin);
  const openEncyclopedia = useUi((s) => s.setEncyclopediaOpen);
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const snapshot = useGame((s) => s.snapshot);
  const status = useGame((s) => s.status);
  const nameOf = usePlayerName();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const onLogout = () => {
    void logout();
    navigateLogin('/'); // home requires auth, so land back on the login screen
  };

  // In-game, the header doubles as the game status bar (connection + whose turn) and
  // carries the "leave" action, so there is a single top bar rather than two stacked rows.
  const inGame = view === 'game' && !!snapshot;
  const turn = snapshot ? turnStatus(snapshot) : null;

  return (
    <header className="app-header">
      <div className="brand">
        <TrainFront size={22} aria-hidden />
        <strong>{t('appName')}</strong>
      </div>

      {inGame && turn && (
        <div className="header-status">
          <span className={`conn conn-${status}`}>
            {status === 'open'
              ? t('connected')
              : status === 'closed'
                ? t('disconnected')
                : t('reconnecting')}
          </span>
          <strong className="turn-label">
            {turn.key === 'turnOf' && turn.player
              ? t('turnOf', { name: nameOf(turn.player) })
              : t(turn.key)}
          </strong>
        </div>
      )}

      <div className="header-actions">
        {user && (
          <span className="user-chip" title={user.isGuest ? t('guest') : (user.email ?? '')}>
            {user.avatarUrl ? (
              <img
                className="user-avatar"
                src={user.avatarUrl}
                alt=""
                width={16}
                height={16}
                referrerPolicy="no-referrer"
              />
            ) : (
              <User size={14} aria-hidden />
            )}{' '}
            {user.displayName}
          </span>
        )}
        {user && view !== 'login' && view !== 'loginCallback' && !inGame && (
          <button onClick={enterHistory} aria-label={t('history.title')} title={t('history.title')}>
            <History size={16} aria-hidden />
          </button>
        )}
        {view !== 'login' && view !== 'loginCallback' && (
          <button
            onClick={() => openEncyclopedia(true)}
            aria-label={t('tutorial.open')}
            title={t('tutorial.open')}
          >
            <BookOpen size={16} aria-hidden />
          </button>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label={t('settings')}
          title={t('settings')}
        >
          <Settings size={16} aria-hidden />
        </button>
        {user && !inGame && (
          <button onClick={onLogout} aria-label={t('logout')} title={t('logout')}>
            <LogOut size={16} aria-hidden />
          </button>
        )}
        {inGame && (
          <button className="leave-btn" onClick={goHome}>
            <DoorOpen size={16} aria-hidden />
            {t('leave')}
          </button>
        )}
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
