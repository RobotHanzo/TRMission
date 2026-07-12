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
import type { LocalGameInput } from './offline/useLocalGame';
import { useSession } from './store/session';

export type RootStackParamList = {
  Boot: undefined;
  Login: undefined;
  Home: undefined;
  Room: { code: string };
  /** The live game (Skia board + the adaptive GameStage HUD). */
  Game: { roomCode: string };
  /** Offline vs-bots: new-game setup, then the sandboxed GameStage. */
  OfflineSetup: undefined;
  OfflineGame: LocalGameInput;
  /** The offline interactive tutorial — registered in BOTH auth branches (no-account reachable). */
  Tutorial: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * A declarative auth gate: which screens exist depends on session state, so a login/logout swaps
 * the whole stack (no imperative navigation races). While booting, only the splash exists.
 */
export function RootNavigator(): React.JSX.Element {
  const { t } = useTranslation();
  const booting = useSession((s) => s.booting);
  const user = useSession((s) => s.user);

  return (
    <Stack.Navigator>
      {booting ? (
        <Stack.Screen name="Boot" component={BootScreen} options={{ headerShown: false }} />
      ) : user ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: t('home.title') }} />
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
