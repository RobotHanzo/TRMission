import { useEffect, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from './store/ui';
import { useSession } from './store/session';
import { AppHeader } from './components/AppHeader';
import { HomeScreen } from './screens/HomeScreen';
import { RoomScreen } from './screens/RoomScreen';
import { GameScreen } from './screens/GameScreen';
import { LoginScreen } from './screens/LoginScreen';
import { LoginCallback } from './screens/LoginCallback';
import './styles/app.css';

// Lazy so @trm/engine + @trm/codec land in a separate chunk, not the main bundle.
const TutorialScreen = lazy(() => import('./features/tutorial/TutorialScreen'));

export function App() {
  const { t, i18n } = useTranslation();
  const view = useUi((s) => s.view);
  const theme = useUi((s) => s.theme);
  const locale = useUi((s) => s.locale);
  const syncFromUrl = useUi((s) => s.syncFromUrl);
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

  const isLogin = view === 'login' || view === 'loginCallback';
  const isGameLayout = view === 'game' || view === 'tutorial';
  const mainClass = isGameLayout
    ? 'app-main app-main--game'
    : isLogin
      ? 'app-main app-main--login'
      : 'app-main';

  return (
    <div className={isGameLayout ? 'app app--game' : 'app'}>
      <AppHeader />
      <main className={mainClass}>
        {booting ? (
          <div className="card">{t('connecting')}</div>
        ) : (
          <>
            {view === 'login' && <LoginScreen />}
            {view === 'loginCallback' && <LoginCallback />}
            {view === 'home' && <HomeScreen />}
            {view === 'room' && <RoomScreen />}
            {view === 'game' && <GameScreen />}
            {view === 'tutorial' && (
              <Suspense fallback={<div className="card">{t('connecting')}</div>}>
                <TutorialScreen />
              </Suspense>
            )}
          </>
        )}
      </main>
    </div>
  );
}
