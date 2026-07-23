import { useEffect } from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { consumePendingRoomLink } from './app/roomLink';
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
import { LeaderboardScreen } from './screens/LeaderboardScreen';
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
  /** Player leaderboard (rating/wins/games-played, all-time or this season). */
  Leaderboard: undefined;
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
  const { tokens, dark } = useTheme();
  const booting = useSession((s) => s.booting);
  const user = useSession((s) => s.user);

  // Deliver a stashed room link (App.tsx's cold-start / signed-out capture) the moment the
  // stack that owns the Room screen is on screen — right after boot for a live session, or
  // right after login/guest entry when the link arrived signed out. Guards run BEFORE the
  // consume so an early fire leaves the stash intact for the next state change.
  useEffect(() => {
    if (booting || !user || !navigationRef.isReady()) return;
    const code = consumePendingRoomLink();
    if (code) navigationRef.navigate('Room', { code });
  }, [booting, user]);

  return (
    // The native-stack header is themed to the app palette (paper/dark), not the OS default white,
    // so sub-screen headers read as part of the app in both themes. Home hides it entirely — its
    // own BrandWordmark is the header, so the OS bar would only duplicate it as a bare white strip.
    // On iOS, pushed screens get a real Liquid Glass bar instead: `headerTransparent` + a blur
    // effect let UIKit render its native iOS 26 glass material rather than a flat colour bar
    // (each such screen pads its own top content with useGlassHeaderPad()). Android keeps the
    // flat opaque bar — Liquid Glass is an iOS-only design language.
    <Stack.Navigator
      screenOptions={{
        headerTintColor: tokens.ink,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: tokens.paper },
        ...(Platform.OS === 'ios'
          ? {
              headerTransparent: true,
              headerBlurEffect: dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight',
            }
          : { headerStyle: { backgroundColor: tokens.surface } }),
      }}
    >
      {booting ? (
        <Stack.Screen name="Boot" component={BootScreen} options={{ headerShown: false }} />
      ) : user ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Room" component={RoomScreen} options={{ title: t('room.title') }} />
          {/* Game surfaces are full-bleed: the stage's floating leave chip replaces the header
              back button (the title still names the browser tab in the web harness). */}
          <Stack.Screen
            name="Game"
            component={GameScreen}
            options={{ title: t('game.title'), headerShown: false }}
          />
          <Stack.Screen
            name="OfflineSetup"
            component={OfflineSetupScreen}
            options={{ title: t('offline.newGame') }}
          />
          <Stack.Screen
            name="OfflineGame"
            component={OfflineGameScreen}
            options={{ title: t('game.title'), headerShown: false }}
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
            name="Leaderboard"
            component={LeaderboardScreen}
            options={{ title: t('leaderboard.title') }}
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
