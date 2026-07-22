import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  LogIn,
  LogOut,
  DoorOpen,
  User,
  BookOpen,
  History,
  Map as MapIcon,
  Menu,
  Trophy,
} from 'lucide-react';
import { useUi } from '../store/ui';
import { useHasFeature, useSession } from '../store/session';
import { useGame } from '../store/game';
import { api } from '../net/rest';
import { turnStatus } from '../game/view';
import { usePlayerName } from '../game/playerName';
import { PHONE_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { SettingsModal } from './SettingsModal';
import { ConfirmDialog } from './ConfirmDialog';
import { BrandBanner } from './BrandBanner';
import { DiscordGlyph } from './icons/DiscordGlyph';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { openDiscord } from '../discord';
import { track } from '../lib/analytics';

export function AppHeader() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const roomCode = useUi((s) => s.roomCode);
  const goHome = useUi((s) => s.goHome);
  const enterHistory = useUi((s) => s.enterHistory);
  const enterLeaderboard = useUi((s) => s.enterLeaderboard);
  const enterMaps = useUi((s) => s.enterMaps);
  const enterLogin = useUi((s) => s.enterLogin);
  const openEncyclopedia = useUi((s) => s.setEncyclopediaOpen);
  const user = useSession((s) => s.user);
  const booting = useSession((s) => s.booting);
  const canBuild = useHasFeature('mapBuilder');
  const logout = useSession((s) => s.logout);
  const snapshot = useGame((s) => s.snapshot);
  const status = useGame((s) => s.status);
  const nameOf = usePlayerName();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Phone: the actions collapse into a hamburger menu (desktop keeps the icon-button row).
  const phone = useMediaQuery(PHONE_QUERY);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const onLogout = () => {
    void logout();
    goHome(); // '/' is public — signing out lands on the landing page
  };

  // In-game, the header doubles as the game status bar (connection + whose turn) and
  // carries the "leave" action, so there is a single top bar rather than two stacked rows.
  const inGame = view === 'game' && !!snapshot;
  const turn = snapshot ? turnStatus(snapshot) : null;
  const connText =
    status === 'open'
      ? t('connected')
      : status === 'closed'
        ? t('disconnected')
        : t('reconnecting');
  const onAuthScreen = view === 'login' || view === 'loginCallback';

  const {
    open: leaveOpen,
    request: requestLeave,
    confirm: confirmLeave,
    cancel: cancelLeave,
  } = useConfirmAction();
  // Leaving the lobby or an active game abandons your seat — tell the server before navigating
  // home so the room doesn't linger stuck on whatever state it was last in (a STARTED room whose
  // game already ended, or a LOBBY room, is freed/closed exactly as the in-room leave button
  // would); from any other screen there's nothing to lose, so this just navigates home.
  const leaveRoomAndGoHome = () => {
    if (roomCode) void api.leaveRoom(roomCode).catch(() => undefined);
    goHome();
  };
  const onBrandClick = () => {
    if (view === 'room' || inGame) requestLeave(leaveRoomAndGoHome);
    else goHome();
  };

  // One menu action per header affordance; closing before acting keeps the menu from
  // lingering over whatever screen the action navigates to.
  const menuAct = (act: () => void) => () => {
    setMenuOpen(false);
    act();
  };

  const avatar = user?.avatarUrl ? (
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
  );

  return (
    <header className="app-header">
      <button type="button" className="brand" onClick={onBrandClick}>
        <BrandBanner size="header" />
      </button>

      {inGame && turn && (
        <div className="header-status">
          <span
            className={`conn conn-${status}`}
            role="status"
            aria-label={connText}
            title={connText}
          >
            <span className="conn-label">{connText}</span>
          </span>
          <strong className="turn-label">
            {turn.key === 'turnOf' && turn.player
              ? t('turnOf', { name: nameOf(turn.player) })
              : t(turn.key)}
          </strong>
        </div>
      )}

      <div className="header-actions">
        {phone ? (
          <div className="header-menu-wrap" ref={menuRef}>
            <button
              className="icon-btn"
              aria-label={t('menu')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Menu size={16} aria-hidden />
            </button>
            {menuOpen && (
              <div className="header-menu" role="menu" aria-label={t('menu')}>
                {!booting && !user && !onAuthScreen && (
                  <button
                    className="header-menu-item"
                    role="menuitem"
                    onClick={menuAct(enterLogin)}
                  >
                    <LogIn size={16} aria-hidden /> {t('signIn')}
                  </button>
                )}
                {user && (
                  <div
                    className="header-menu-user"
                    title={user.isGuest ? t('guest') : (user.email ?? '')}
                  >
                    {avatar} {user.displayName}
                  </div>
                )}
                {user && !onAuthScreen && !inGame && (
                  <button
                    className="header-menu-item"
                    role="menuitem"
                    onClick={menuAct(enterHistory)}
                  >
                    <History size={16} aria-hidden /> {t('history.title')}
                  </button>
                )}
                {user && !onAuthScreen && !inGame && (
                  <button
                    className="header-menu-item"
                    role="menuitem"
                    onClick={menuAct(enterLeaderboard)}
                  >
                    <Trophy size={16} aria-hidden /> {t('leaderboard.title')}
                  </button>
                )}
                {user && !onAuthScreen && !inGame && canBuild && (
                  <button className="header-menu-item" role="menuitem" onClick={menuAct(enterMaps)}>
                    <MapIcon size={16} aria-hidden /> {t('builder.myMaps')}
                  </button>
                )}
                {!onAuthScreen && (
                  <button
                    className="header-menu-item"
                    role="menuitem"
                    onClick={menuAct(() => {
                      track('encyclopedia_open', {});
                      openEncyclopedia(true);
                    })}
                  >
                    <BookOpen size={16} aria-hidden /> {t('tutorial.open')}
                  </button>
                )}
                <button
                  className="header-menu-item"
                  role="menuitem"
                  onClick={menuAct(() => {
                    track('discord_click', { source: 'header' });
                    openDiscord();
                  })}
                >
                  <DiscordGlyph size={16} /> {t('discord')}
                </button>
                <button
                  className="header-menu-item"
                  role="menuitem"
                  onClick={menuAct(() => setSettingsOpen(true))}
                >
                  <Settings size={16} aria-hidden /> {t('settings')}
                </button>
                {user && !inGame && (
                  <button
                    className="header-menu-item header-menu-item--danger"
                    role="menuitem"
                    onClick={menuAct(onLogout)}
                  >
                    <LogOut size={16} aria-hidden /> {t('logout')}
                  </button>
                )}
                {inGame && (
                  <button
                    className="header-menu-item header-menu-item--danger"
                    role="menuitem"
                    onClick={menuAct(() => requestLeave(leaveRoomAndGoHome))}
                  >
                    <DoorOpen size={16} aria-hidden /> {t('leave')}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {user && (
              <span className="user-chip" title={user.isGuest ? t('guest') : (user.email ?? '')}>
                {avatar} <span className="user-chip-name">{user.displayName}</span>
              </span>
            )}
            {user && !onAuthScreen && !inGame && (
              <button
                onClick={enterHistory}
                aria-label={t('history.title')}
                title={t('history.title')}
              >
                <History size={16} aria-hidden />
              </button>
            )}
            {user && !onAuthScreen && !inGame && (
              <button
                onClick={enterLeaderboard}
                aria-label={t('leaderboard.title')}
                title={t('leaderboard.title')}
              >
                <Trophy size={16} aria-hidden />
              </button>
            )}
            {user && !onAuthScreen && !inGame && canBuild && (
              <button
                onClick={enterMaps}
                aria-label={t('builder.myMaps')}
                title={t('builder.myMaps')}
              >
                <MapIcon size={16} aria-hidden />
              </button>
            )}
            {!onAuthScreen && (
              <button
                onClick={() => {
                  track('encyclopedia_open', {});
                  openEncyclopedia(true);
                }}
                aria-label={t('tutorial.open')}
                title={t('tutorial.open')}
              >
                <BookOpen size={16} aria-hidden />
              </button>
            )}
            <button
              onClick={() => {
                track('discord_click', { source: 'header' });
                openDiscord();
              }}
              aria-label={t('discord')}
              title={t('discord')}
            >
              <DiscordGlyph size={16} />
            </button>
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
            {!booting && !user && !onAuthScreen && (
              <button className="primary header-signin" onClick={enterLogin}>
                <LogIn size={16} aria-hidden />
                {t('signIn')}
              </button>
            )}
            {inGame && (
              <button className="leave-btn" onClick={() => requestLeave(leaveRoomAndGoHome)}>
                <DoorOpen size={16} aria-hidden />
                {t('leave')}
              </button>
            )}
          </>
        )}
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {leaveOpen && (
        <ConfirmDialog
          title={t('leaveConfirmTitle')}
          message={t('leaveConfirmBody')}
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
      )}
    </header>
  );
}
