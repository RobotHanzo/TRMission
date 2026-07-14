import { createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { BootScreen } from './screens/BootScreen';
import { GameScreen } from './screens/GameScreen';
import { HomeScreen } from './screens/HomeScreen';
import { RoomScreen } from './screens/RoomScreen';
import { LoginScreen } from './screens/LoginScreen';
import { OfflineSetupScreen } from './screens/OfflineSetupScreen';
import { OfflineGameScreen } from './screens/OfflineGameScreen';
import TutorialScreen from './features/tutorial/TutorialScreen';
import BuilderScreen from './screens/BuilderScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import ReplayScreen from './screens/ReplayScreen';
import EncyclopediaScreen from './screens/EncyclopediaScreen';
import type { LocalGameInput } from './offline/useLocalGame';
import { useSession } from './store/session';
import { useTheme } from './theme/useTheme';

export type RootStackParamList = {
  Boot: undefined;
  Login: undefined;
  Home: undefined;
  Room: { code: string };
  /** The live game (Skia board + the adaptive GameStage HUD). Spectators mint via /spectate. */
  Game: { roomCode: string; spectator?: boolean };
  /** Offline vs-bots: new-game setup, then the sandboxed GameStage. */
  OfflineSetup: undefined;
  OfflineGame: LocalGameInput;
  /** The offline interactive tutorial — registered in BOTH auth branches (no-account reachable). */
  Tutorial: undefined;
  /** The map-builder WebView (mapBuilder feature; authed stack only). */
  Builder: undefined;
  /** Device settings + account controls (push/haptics toggles, account deletion). */
  Settings: undefined;
  /** Finished games (players + spectated) — each replayable row opens the Replay player. */
  History: undefined;
  /** Client-side replay of a finished game through the sandbox GameStage. */
  Replay: { gameId: string };
  /** The rules encyclopedia: chapter-grouped topics with auto-playing sandbox demos. */
  Encyclopedia: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Imperative navigation handle for non-component callers (push notification taps). */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * A declarative auth gate: which screens exist depends on session state, so a login/logout swaps
 * the whole stack (no imperative navigation races). While booting, only the splash exists.
 */
export function RootNavigator(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const booting = useSession((s) => s.booting);
  const user = useSession((s) => s.user);

  return (
    // The native-stack header is themed to the app palette (paper/dark), not the OS default white,
    // so sub-screen headers read as part of the app in both themes. Home hides it entirely — its
    // own BrandWordmark is the header, so the OS bar would only duplicate it as a bare white strip.
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: tokens.surface },
        headerTintColor: tokens.ink,
        headerTitleStyle: { color: tokens.ink, fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: tokens.paper },
      }}
    >
      {booting ? (
        <Stack.Screen name="Boot" component={BootScreen} options={{ headerShown: false }} />
      ) : user ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Room" component={RoomScreen} options={{ title: t('room.title') }} />
          <Stack.Screen name="Game" component={GameScreen} options={{ title: t('game.title') }} />
          <Stack.Screen
            name="OfflineSetup"
            component={OfflineSetupScreen}
            options={{ title: t('offline.newGame') }}
          />
          <Stack.Screen
            name="OfflineGame"
            component={OfflineGameScreen}
            options={{ title: t('game.title') }}
          />
          <Stack.Screen
            name="Tutorial"
            component={TutorialScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Builder"
            component={BuilderScreen}
            options={{ title: t('builder.title') }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: t('settings.title') }}
          />
          <Stack.Screen
            name="History"
            component={HistoryScreen}
            options={{ title: t('history.title') }}
          />
          <Stack.Screen
            name="Replay"
            component={ReplayScreen}
            options={{ title: t('history.watchReplay') }}
          />
          <Stack.Screen
            name="Encyclopedia"
            component={EncyclopediaScreen}
            options={{ title: t('tutorial.open') }}
          />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen
            name="Tutorial"
            component={TutorialScreen}
            options={{ headerShown: false }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
