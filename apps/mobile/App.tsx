import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/i18n'; // initialise the i18n singleton before any screen uses useTranslation

// Hold the native splash through the boot chain (forced-update check → prefs hydrate → session
// restore) — BootScreen releases it once it knows what to show. `.catch`: already-hidden /
// jest-mocked environments must not crash the module load.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
import { navigationRef, RootNavigator } from './src/navigation';
import { watchTokenRotation } from './src/push/register';
import {
  installNotificationHandler,
  installNotificationTapHandling,
} from './src/push/notifications';
import { useOrientationPolicy } from './src/app/useOrientationPolicy';

// Registering the deep-link prefixes lets a cold-start OAuth return (/m/callback) or a
// trmission:// link resolve. The active OAuth flow is handled in-process by openAuthSessionAsync.
// `trmission://room/CODE` (and the web share URL's /room/CODE path) lands straight in that
// room's lobby — the RoomScreen's shared poll joins/spectates exactly like a web link visit.
const linking = {
  prefixes: ['trmission://', 'https://trmission.example'],
  config: {
    screens: {
      Room: 'room/:code',
    },
  },
};

export default function App() {
  // FCM/APNs rotate device tokens; keep the server registry current for the app's lifetime.
  useEffect(() => watchTokenRotation(), []);
  // Foreground display policy + notification-tap deep links (warm and cold start).
  useEffect(() => {
    installNotificationHandler();
    return installNotificationTapHandling(navigationRef);
  }, []);
  // Phones lock portrait; tablets rotate freely (and must survive live resizing regardless).
  useOrientationPolicy();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef} linking={linking}>
          <RootNavigator />
        </NavigationContainer>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
