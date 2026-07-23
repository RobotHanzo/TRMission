import { Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { HomeTabParamList } from './navigation';
import { HomeScreen } from './screens/HomeScreen';
import EncyclopediaScreen from './screens/EncyclopediaScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useTheme } from './theme/useTheme';
import HOME_ICON from '../assets/tabs/home.png';
import ENCYCLOPEDIA_ICON from '../assets/tabs/encyclopedia.png';
import LEADERBOARD_ICON from '../assets/tabs/leaderboard.png';
import SETTINGS_ICON from '../assets/tabs/settings.png';

const Tab = createBottomTabNavigator<HomeTabParamList>();

/** react-native-bottom-tabs (HomeTabs.tsx) uses native platform primitives that don't exist in a
 *  browser — this is its JS-rendered fallback, used ONLY by the react-native-web Playwright test
 *  harness (`yarn workspace @trm/mobile web`, see apps/mobile/CLAUDE.md). No glass, no SF Symbols;
 *  same 4 tabs and the same template PNGs (tinted via `tintColor`) so it's a faithful functional
 *  stand-in even though it isn't a visual match. */
function tabIcon(png: number) {
  return ({ color }: { color: string }): React.JSX.Element => (
    <Image source={png} style={{ width: 24, height: 24, tintColor: color }} resizeMode="contain" />
  );
}

export default function HomeTabs(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: tokens.blue }}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: tabIcon(HOME_ICON) }} />
      <Tab.Screen
        name="Encyclopedia"
        component={EncyclopediaScreen}
        options={{ title: t('tutorial.open'), tabBarIcon: tabIcon(ENCYCLOPEDIA_ICON) }}
      />
      <Tab.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{ title: t('leaderboard.title'), tabBarIcon: tabIcon(LEADERBOARD_ICON) }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t('settings.title'), tabBarIcon: tabIcon(SETTINGS_ICON) }}
      />
    </Tab.Navigator>
  );
}
