import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { BoardSpikeScreen } from './screens/BoardSpikeScreen';
import { BootScreen } from './screens/BootScreen';
import { GamePlaceholderScreen } from './screens/GamePlaceholderScreen';
import { HomeScreen } from './screens/HomeScreen';
import { RoomScreen } from './screens/RoomScreen';
import { LoginScreen } from './screens/LoginScreen';
import { useSession } from './store/session';

export type RootStackParamList = {
  Boot: undefined;
  Login: undefined;
  Home: undefined;
  Room: { code: string };
  /** P2 replaces GamePlaceholderScreen with the real Skia board here. */
  Game: { roomCode: string };
  /** Dev-only board rendering spike (P2 Task 1 device gate). */
  BoardSpike: undefined;
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
          <Stack.Screen
            name="Game"
            component={GamePlaceholderScreen}
            options={{ title: t('game.title') }}
          />
          {__DEV__ && (
            <Stack.Screen
              name="BoardSpike"
              component={BoardSpikeScreen}
              options={{ headerShown: false }}
            />
          )}
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}
