import { useEffect, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from './store/ui';
import { useHasFeature, useSession } from './store/session';
import { AppHeader } from './components/AppHeader';
import { useLeaveWarning } from './hooks/useLeaveWarning';
import { HomeScreen } from './screens/HomeScreen';
import { RoomScreen } from './screens/RoomScreen';
import { GameScreen } from './screens/GameScreen';
import { LoginScreen } from './screens/LoginScreen';
import { LoginCallback } from './screens/LoginCallback';
import { HistoryScreen } from './screens/HistoryScreen';
import './styles/app.css';
import './styles/home.css';

// Lazy so @trm/engine + @trm/codec land in a separate chunk, not the main bundle.
const TutorialScreen = lazy(() => import('./features/tutorial/TutorialScreen'));
const EncyclopediaModal = lazy(() => import('./features/tutorial/EncyclopediaModal'));
const ReplayScreen = lazy(() => import('./screens/ReplayScreen'));
const AdminReplayScreen = lazy(() => import('./screens/AdminReplayScreen'));
// The map builder (world data + zod-shaped editor state) is its own chunk too.
const MapsScreen = lazy(() => import('./features/builder/MapsScreen'));
const MapEditorScreen = lazy(() => import('./features/builder/editor/EditorScreen'));

export function App() {
  const { t, i18n } = useTranslation();
  const view = useUi((s) => s.view);
  const theme = useUi((s) => s.theme);
  const locale = useUi((s) => s.locale);
  const syncFromUrl = useUi((s) => s.syncFromUrl);
  const encyclopediaOpen = useUi((s) => s.encyclopediaOpen);
  const setEncyclopediaOpen = useUi((s) => s.setEncyclopediaOpen);
  const user = useSession((s) => s.user);
  const booting = useSession((s) => s.booting);
  const restore = useSession((s) => s.restore);
  const canBuild = useHasFeature('mapBuilder');
  const goHome = useUi((s) => s.goHome);

  useLeaveWarning();

  // The map builder is feature-gated: a direct /maps URL without the grant lands home.
  // (Cosmetic only — the server 403s regardless.)
  useEffect(() => {
    if (!booting && user && (view === 'maps' || view === 'mapEditor') && !canBuild) goHome();
  }, [booting, user, view, canBuild, goHome]);

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
  const isGameLayout =
    view === 'game' ||
    view === 'tutorial' ||
    view === 'replay' ||
    view === 'adminReplay' ||
    view === 'mapEditor';
  const mainClass = isGameLayout
    ? 'app-main app-main--game'
    : isLogin
      ? 'app-main app-main--login'
      : view === 'home'
        ? 'app-main app-main--home' // the hero + two-column grid needs more than the reading column
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
            {view === 'history' && <HistoryScreen />}
            {view === 'maps' && (
              <Suspense fallback={<div className="card">{t('connecting')}</div>}>
                <MapsScreen />
              </Suspense>
            )}
            {view === 'mapEditor' && (
              <Suspense fallback={<div className="card">{t('connecting')}</div>}>
                <MapEditorScreen />
              </Suspense>
            )}
            {view === 'replay' && (
              <Suspense fallback={<div className="card">{t('connecting')}</div>}>
                <ReplayScreen />
              </Suspense>
            )}
            {view === 'adminReplay' && (
              <Suspense fallback={<div className="card">{t('connecting')}</div>}>
                <AdminReplayScreen />
              </Suspense>
            )}
            {view === 'game' && <GameScreen />}
            {view === 'tutorial' && (
              <Suspense fallback={<div className="card">{t('connecting')}</div>}>
                <TutorialScreen />
              </Suspense>
            )}
          </>
        )}
      </main>
      {encyclopediaOpen && (
        <Suspense fallback={null}>
          <EncyclopediaModal onClose={() => setEncyclopediaOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
