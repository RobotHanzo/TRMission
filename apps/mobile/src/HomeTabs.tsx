import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
import type { AppleIcon } from 'react-native-bottom-tabs';
import type { SFSymbol } from 'sf-symbols-typescript';
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

const Tab = createNativeBottomTabNavigator<HomeTabParamList>();

/** iOS renders SF Symbols directly (zero asset cost, and what makes the Liquid Glass tint/glow
 *  respond correctly per react-native-bottom-tabs' docs); other platforms use a pre-generated
 *  template PNG (scripts/gen-brand-assets.js → assets/tabs/*.png). */
function tabIcon(sfSymbol: SFSymbol, png: number): () => AppleIcon | number {
  return () => (Platform.OS === 'ios' ? { sfSymbol } : png);
}

/**
 * The app's 4 primary destinations as a floating native tab bar — a real `UITabBarController` on
 * iOS (rendered with the system's Liquid Glass material on iOS 26+, no manual opt-in needed) and
 * a Material3 bottom bar on Android. This is the "Home" screen's component in the outer stack
 * (navigation.tsx); everything else (Room, Game, History, Replay, Builder, Tutorial,
 * OfflineSetup/Game) stays a push screen in that outer stack, which hides this bar entirely while
 * active — standard nested-navigator behaviour, no extra wiring needed.
 *
 * Metro resolves this file on iOS/Android; `HomeTabs.web.tsx` is the JS-rendered fallback for the
 * react-native-web Playwright harness (native tab bars don't run in a browser).
 */
export default function HomeTabs(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  return (
    <Tab.Navigator tabBarActiveTintColor={tokens.blue}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: t('home.tab'), tabBarIcon: tabIcon('house.fill', HOME_ICON) }}
      />
      <Tab.Screen
        name="Encyclopedia"
        component={EncyclopediaScreen}
        options={{
          title: t('tutorial.open'),
          tabBarIcon: tabIcon('book.fill', ENCYCLOPEDIA_ICON),
        }}
      />
      <Tab.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{
          title: t('leaderboard.title'),
          tabBarIcon: tabIcon('trophy.fill', LEADERBOARD_ICON),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: t('settings.title'),
          tabBarIcon: tabIcon('gearshape.fill', SETTINGS_ICON),
        }}
      />
    </Tab.Navigator>
  );
}
