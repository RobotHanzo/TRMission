import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/i18n'; // initialise the i18n singleton before any screen uses useTranslation
import { navigationRef, RootNavigator } from './src/navigation';
import { watchTokenRotation } from './src/push/register';
import {
  installNotificationHandler,
  installNotificationTapHandling,
} from './src/push/notifications';

// Registering the deep-link prefixes lets a cold-start OAuth return (/m/callback) or a
// trmission:// link resolve. The active OAuth flow is handled in-process by openAuthSessionAsync.
const linking = {
  prefixes: ['trmission://', 'https://trmission.example'],
};

export default function App() {
  // FCM/APNs rotate device tokens; keep the server registry current for the app's lifetime.
  useEffect(() => watchTokenRotation(), []);
  // Foreground display policy + notification-tap deep links (warm and cold start).
  useEffect(() => {
    installNotificationHandler();
    return installNotificationTapHandling(navigationRef);
  }, []);
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
