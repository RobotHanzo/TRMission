import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/i18n'; // initialise the i18n singleton before any screen uses useTranslation
import { RootNavigator } from './src/navigation';

// Registering the deep-link prefixes lets a cold-start OAuth return (/m/callback) or a
// trmission:// link resolve. The active OAuth flow is handled in-process by openAuthSessionAsync.
const linking = {
  prefixes: ['trmission://', 'https://trmission.example'],
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer linking={linking}>
          <RootNavigator />
        </NavigationContainer>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
