// The Settings tab's own native stack (issue #47). Nested INSIDE the tab rather than pushed onto
// the root stack on purpose: drilling into a settings group keeps the floating tab bar, which is
// how a settings tab is expected to behave — and it keeps six leaf routes out of the root stack's
// param list. Header theming mirrors navigation.tsx (Liquid Glass on iOS, flat bar on Android);
// the index hides the header entirely because it carries its own title.
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import type { SettingsStackParamList } from '../../navigation';
import { useTheme } from '../../theme/useTheme';
import { SettingsScreen } from '../SettingsScreen';
import AboutScreen from './AboutScreen';
import AccountScreen from './AccountScreen';
import AppearanceScreen from './AppearanceScreen';
import NotificationsScreen from './NotificationsScreen';
import PrivacyScreen from './PrivacyScreen';
import SoundScreen from './SoundScreen';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsNavigator(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens, dark } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerTintColor: tokens.ink,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: tokens.paper },
        ...(Platform.OS === 'ios'
          ? {
              headerTransparent: true,
              headerBlurEffect: dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight',
            }
          : { headerStyle: { backgroundColor: tokens.surface } }),
      }}
    >
      <Stack.Screen
        name="SettingsIndex"
        component={SettingsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SettingsAppearance"
        component={AppearanceScreen}
        options={{ title: t('settings.appearance') }}
      />
      <Stack.Screen
        name="SettingsSound"
        component={SoundScreen}
        options={{ title: t('settings.soundGroup') }}
      />
      <Stack.Screen
        name="SettingsNotifications"
        component={NotificationsScreen}
        options={{ title: t('settings.notifications') }}
      />
      <Stack.Screen
        name="SettingsPrivacy"
        component={PrivacyScreen}
        options={{ title: t('settings.adsGroup') }}
      />
      <Stack.Screen
        name="SettingsAccount"
        component={AccountScreen}
        options={{ title: t('settings.accountGroup') }}
      />
      <Stack.Screen
        name="SettingsAbout"
        component={AboutScreen}
        options={{ title: t('settings.about') }}
      />
    </Stack.Navigator>
  );
}
