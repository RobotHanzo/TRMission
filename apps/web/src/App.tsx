import { useEffect, useRef, useState, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi, isHomeColdLoadPath } from './store/ui';
import { useHasFeature, useSession } from './store/session';
import { AppHeader } from './components/AppHeader';
import { MobileAppPrompt } from './components/MobileAppPrompt';
import { useLeaveWarning } from './hooks/useLeaveWarning';
import { usePageViewTracking } from './hooks/usePageViewTracking';
import { useSoundSetup } from './hooks/useSoundSetup';
import { useDocumentMeta } from './hooks/useDocumentMeta';
import { useAutoReload } from './hooks/useAutoReload';
import { useTrainCarSkinCatalog } from './theme/useTrainCarSkin';
import { lazyChunk } from './lib/preloadRecovery';
import { setSentryGameContext, setSentryUser } from './observability/report';
import { HomeScreen } from './screens/HomeScreen';
import { LandingScreen } from './screens/LandingScreen';
import { LoginScreen } from './screens/LoginScreen';
import { LoginCallback } from './screens/LoginCallback';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { TermsScreen } from './screens/TermsScreen';
import './styles/app.css';
import './styles/home.css';

// Lazy so @trm/engine + @trm/codec land in a separate chunk, not the main bundle. Every one of
// these loads through `lazyChunk`, never `lazy` directly: it carries the stale-deploy/flaky-network
// recovery contract (lib/preloadRecovery.ts), without which a failed chunk fetch crashes the app.
const TutorialScreen = lazyChunk(() => import('./features/tutorial/TutorialScreen'));
const EncyclopediaModal = lazyChunk(() => import('./features/tutorial/EncyclopediaModal'));
const ReplayScreen = lazyChunk(() => import('./screens/ReplayScreen'));
const AdminReplayScreen = lazyChunk(() => import('./screens/AdminReplayScreen'));
const AdminSpectateScreen = lazyChunk(() => import('./screens/AdminSpectateScreen'));
// The map builder (world data + zod-shaped editor state) is its own chunk too.
const MapsScreen = lazyChunk(() => import('./features/builder/MapsScreen'));
const MapEditorScreen = lazyChunk(() => import('./features/builder/editor/EditorScreen'));
// The in-game + lobby UI (board interaction, protobuf command codec, panels, chat) and the
// auth-gated secondary screens are all off the public landing/login funnel — keep them out of
// the main chunk so a first paint of `/` doesn't ship code it never runs.
const RoomScreen = lazyChunk(
  () => import('./screens/RoomScreen'),
  (m) => m.RoomScreen,
);
const GameScreen = lazyChunk(
  () => import('./screens/GameScreen'),
  (m) => m.GameScreen,
);
const HistoryScreen = lazyChunk(
  () => import('./screens/HistoryScreen'),
  (m) => m.HistoryScreen,
);
const LeaderboardScreen = lazyChunk(
  () => import('./screens/LeaderboardScreen'),
  (m) => m.LeaderboardScreen,
);
const DeleteAccountScreen = lazyChunk(
  () => import('./screens/DeleteAccountScreen'),
  (m) => m.DeleteAccountScreen,
);
// Public, but off the landing/login funnel — a visitor only reaches /support deliberately.
const SupportScreen = lazyChunk(() => import('./screens/SupportScreen'));

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
  const roomCode = useUi((s) => s.roomCode);
  const gameId = useUi((s) => s.gameId);

  useLeaveWarning();
  usePageViewTracking();
  useSoundSetup();
  useDocumentMeta();
  useAutoReload();
  // Which train-card skin packs are on offer — fetched once here so a hand of cards doesn't.
  useTrainCarSkinCatalog(!!user);

  // '/' (and any unrecognized path, which falls back to it) never needs `authed` to decide what
  // to render — App picks landing vs. home off `user` directly — so a cold load there can paint
  // immediately instead of waiting on the session probe. Every other path DOES need `authed`
  // (to render vs. redirect to /login) and keeps the boot gate. Captured once: it only describes
  // the URL this tab was cold-loaded with, not later in-app navigation.
  const [homeColdLoad] = useState(isHomeColdLoadPath);

  // The map builder is feature-gated: a direct /maps URL without the grant lands home.
  // (Cosmetic only — the server 403s regardless.)
  useEffect(() => {
    if (!booting && user && (view === 'maps' || view === 'mapEditor') && !canBuild) goHome();
  }, [booting, user, view, canBuild, goHome]);

  useEffect(() => {
    void restore();
  }, [restore]);

  // Tell Sentry WHO and WHICH match, so a report is actionable: the account's id, email and
  // display name — never anything from the game snapshot (all no-ops without a DSN). Read as three
  // scalars so the effect doesn't re-fire on every unrelated session-store update.
  const userId = user?.id;
  const userEmail = user?.email;
  const userName = user?.displayName;
  useEffect(() => {
    setSentryUser(
      userId
        ? {
            id: userId,
            ...(userEmail ? { email: userEmail } : {}),
            ...(userName ? { username: userName } : {}),
          }
        : null,
    );
  }, [userId, userEmail, userName]);
  useEffect(() => {
    setSentryGameContext({ ...(gameId ? { gameId } : {}), ...(roomCode ? { roomCode } : {}) });
  }, [gameId, roomCode]);

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
    view === 'adminSpectate' ||
    view === 'mapEditor';
  const mainClass = isGameLayout
    ? 'app-main app-main--game'
    : isLogin
      ? 'app-main app-main--login'
      : view === 'home'
        ? user
          ? 'app-main app-main--home' // the hero + two-column grid needs more than the reading column
          : 'app-main app-main--landing' // signed out: the full-bleed public landing page
        : view === 'room'
          ? 'app-main app-main--room' // the room+chat two-column grid needs more than the reading column
          : 'app-main';

  return (
    <div className={isGameLayout ? 'app app--game' : 'app'}>
      <AppHeader />
      <main className={mainClass}>
        {booting && !homeColdLoad ? (
          <div className="card">{t('connecting')}</div>
        ) : (
          // One boundary for every lazy screen (only one view renders at a time, so a single
          // fallback is equivalent to per-view ones); eager screens render without suspending.
          <Suspense fallback={<div className="card">{t('connecting')}</div>}>
            {view === 'login' && <LoginScreen />}
            {view === 'loginCallback' && <LoginCallback />}
            {/* '/' is never auth-gated: signed-out visitors get the public landing page. */}
            {view === 'home' && (user ? <HomeScreen /> : <LandingScreen />)}
            {view === 'room' && <RoomScreen />}
            {view === 'history' && <HistoryScreen />}
            {view === 'leaderboard' && <LeaderboardScreen />}
            {view === 'deleteAccount' && <DeleteAccountScreen />}
            {view === 'support' && <SupportScreen />}
            {view === 'privacy' && <PrivacyScreen />}
            {view === 'terms' && <TermsScreen />}
            {view === 'maps' && <MapsScreen />}
            {view === 'mapEditor' && <MapEditorScreen />}
            {view === 'replay' && <ReplayScreen />}
            {view === 'adminReplay' && <AdminReplayScreen />}
            {view === 'adminSpectate' && <AdminSpectateScreen />}
            {view === 'game' && <GameScreen />}
            {view === 'tutorial' && <TutorialScreen />}
          </Suspense>
        )}
      </main>
      {encyclopediaOpen && (
        <Suspense fallback={null}>
          <EncyclopediaModal onClose={() => setEncyclopediaOpen(false)} />
        </Suspense>
      )}
      {/* Mobile browsers get one dismissible "the app exists" sheet; it decides for itself whether
          this device and view qualify, and renders nothing anywhere else. */}
      <MobileAppPrompt />
    </div>
  );
}
