import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Linking } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/i18n'; // initialise the i18n singleton before any screen uses useTranslation

// Hold the native splash through the boot chain (forced-update check → prefs hydrate → session
// restore) — BootScreen releases it once it knows what to show. `.catch`: already-hidden /
// jest-mocked environments must not crash the module load.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
import { navigationRef, RootNavigator } from './src/navigation';
import { RootErrorBoundary } from './src/app/RootErrorBoundary';
import { navigationIntegration, setSentryUser } from './src/app/sentry';
import { SERVER_ORIGIN } from './src/config';
import { watchTokenRotation } from './src/push/register';
import {
  installNotificationHandler,
  installNotificationTapHandling,
} from './src/push/notifications';
import { useOrientationPolicy } from './src/app/useOrientationPolicy';
import { stashRoomLink } from './src/app/roomLink';
import { initAds } from './src/ads/ads';
import { useSession } from './src/store/session';
import * as Sentry from '@sentry/react-native';
import { useSoundSetup } from './src/hooks/useSoundSetup';

// Registering the deep-link prefixes lets a cold-start OAuth return (/m/callback) or a
// trmission:// link resolve. The active OAuth flow is handled in-process by openAuthSessionAsync.
// `trmission://room/CODE` (and the web share URL's /room/CODE path) lands straight in that
// room's lobby — the RoomScreen's shared poll joins/spectates exactly like a web link visit.
const linking = {
  prefixes: ['trmission://', SERVER_ORIGIN],
  config: {
    screens: {
      Room: 'room/:code',
    },
  },
};

function App() {
  // FCM/APNs rotate device tokens; keep the server registry current for the app's lifetime.
  useEffect(() => watchTokenRotation(), []);

  // AdMob comes up once the boot chain has released the splash — NOT from index.ts like Sentry.
  // Its first steps are the UMP consent form and the iOS ATT prompt, both native modals: Apple
  // requires the app to be foregrounded and visible before ATT is requested, and stacking a consent
  // sheet on top of the splash would ask a user to decide about an app they have not seen yet.
  // Runs once (initAds self-guards) and never rejects.
  const booting = useSession((s) => s.booting);
  useEffect(() => {
    if (!booting) void initAds();
  }, [booting]);

  // Which account hit the error — the id only, never a display name or email (no-op without a DSN).
  const userId = useSession((s) => s.user?.id ?? null);
  useEffect(() => setSentryUser(userId), [userId]);
  // Foreground display policy + notification-tap deep links (warm and cold start). A tap that
  // arrives before the signed-in stack exists (cold start, or signed out) can't navigate — same
  // constraint as the room links below — so it is stashed and RootNavigator delivers it.
  useEffect(() => {
    installNotificationHandler();
    return installNotificationTapHandling(navigationRef, () => {
      const s = useSession.getState();
      return !s.booting && !!s.user;
    });
  }, []);
  // Room links the `linking` config above can't deliver: the LAUNCH URL resolves while the
  // auth-gated stack only contains Boot (so the Room route is dropped), and a warm tap while
  // signed OUT has no Room screen to land on either. Stash those here; RootNavigator applies
  // the stash once the signed-in stack is live. Warm signed-in taps stay with `linking`.
  useEffect(() => {
    void Linking.getInitialURL().then((url) => url && stashRoomLink(url));
    const sub = Linking.addEventListener('url', ({ url }) => {
      const s = useSession.getState();
      if (s.booting || !s.user) stashRoomLink(url);
    });
    return () => sub.remove();
  }, []);
  // Phones lock portrait; tablets rotate freely (and must survive live resizing regardless).
  useOrientationPolicy();
  useSoundSetup();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RootErrorBoundary>
          <NavigationContainer
            ref={navigationRef}
            linking={linking}
            // Names screen-to-screen transactions for Sentry tracing; no-op without a DSN.
            onReady={() => navigationIntegration.registerNavigationContainer(navigationRef)}
          >
            <RootNavigator />
          </NavigationContainer>
        </RootErrorBoundary>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// `Sentry.wrap` installs the SDK's own touch/navigation breadcrumbs and the auto-performance
// root span around the whole tree. Inert until `initSentry()` has run with a DSN.
export default Sentry.wrap(App);
