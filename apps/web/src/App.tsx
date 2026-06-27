import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi, roomCodeFromPath } from './store/ui';
import { useSession } from './store/session';
import { AppHeader } from './components/AppHeader';
import { HomeScreen } from './screens/HomeScreen';
import { RoomScreen } from './screens/RoomScreen';
import { GameScreen } from './screens/GameScreen';
import './styles/app.css';

export function App() {
  const { t, i18n } = useTranslation();
  const view = useUi((s) => s.view);
  const theme = useUi((s) => s.theme);
  const locale = useUi((s) => s.locale);
  const syncFromUrl = useUi((s) => s.syncFromUrl);
  const enterRoom = useUi((s) => s.enterRoom);
  const user = useSession((s) => s.user);
  const booting = useSession((s) => s.booting);
  const restore = useSession((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  // Once the session probe settles, adopt the view from the URL exactly once — this is
  // what turns a hard reload of /room/:code back into that lobby/game.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (booting || bootstrapped.current) return;
    bootstrapped.current = true;
    syncFromUrl(!!user);
  }, [booting, user, syncFromUrl]);

  // Keep the view in step with browser back/forward.
  useEffect(() => {
    const onPop = (): void => syncFromUrl(!!useSession.getState().user);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [syncFromUrl]);

  // A /room/:code link opened while logged out shows the auth gate (view stays 'home' with
  // the URL preserved). Once the user signs in or plays as guest, resume into that room —
  // RoomScreen then joins it if they aren't already a member.
  useEffect(() => {
    if (booting || !user || view !== 'home') return;
    const code = roomCodeFromPath();
    if (code) enterRoom(code);
  }, [booting, user, view, enterRoom]);

  // Apply the chosen locale to i18next + <html lang> (covers the localStorage-seeded initial value).
  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }, [i18n, locale]);

  // Resolve the theme ('system' follows the OS) and stamp it on <html> for the CSS tokens.
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  return (
    <div className={view === 'game' ? 'app app--game' : 'app'}>
      <AppHeader />
      <main className={view === 'game' ? 'app-main app-main--game' : 'app-main'}>
        {booting ? (
          <div className="card">{t('connecting')}</div>
        ) : (
          <>
            {view === 'home' && <HomeScreen />}
            {view === 'room' && <RoomScreen />}
            {view === 'game' && <GameScreen />}
          </>
        )}
      </main>
    </div>
  );
}
