// The settings INDEX (issue #47): a departure board of the five groups, each stating what it is
// currently set to, plus the account plate that leads to sign-out and deletion. Every group is a
// pushed page inside the Settings tab's own stack (screens/settings/SettingsNavigator.tsx) — the
// tab bar stays put, so a settings detour never loses the player their place in the app.
//
// The dashed leader running from each group name out to its value is the point of the layout:
// the reader can answer "what is my sound set to?" from the index, so pushing the controls one
// level down costs them nothing.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  ChevronRight,
  Info,
  LifeBuoy,
  Palette,
  ShieldCheck,
  Volume2,
} from 'lucide-react-native';
import { APP_VERSION } from '../config';
import { openSupport } from '../support';
import type { SettingsStackParamList } from '../navigation';
import { useSettings } from '../store/settings';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useTheme } from '../theme/useTheme';
import { MutedText } from '../theme/chrome';
import { NavRow, SettingsGroup, SettingsPage } from './settings/chrome';
import { AccountAvatar } from './settings/identity';

type Props = NativeStackScreenProps<SettingsStackParamList, 'SettingsIndex'>;

export function SettingsScreen({ navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  // A tab screen renders full-bleed (no stack header, floating iOS tab bar): the notch row gets
  // hard padding, while SettingsPage puts the bottom pad on the CONTENT so rows scroll out from
  // under the glass bar.
  const insets = useSafeAreaInsets();

  const user = useSession((s) => s.user);
  const isGuest = user?.isGuest ?? true;

  const theme = useUi((s) => s.theme);
  const locale = useUi((s) => s.locale);
  const soundEnabled = useUi((s) => s.soundEnabled);
  const soundVolume = useUi((s) => s.soundVolume);
  const notifications = useSettings((s) => s.notifications);
  const onlyWhenAway = useSettings((s) => s.notifyOnlyWhenAway);

  const themeLabel = t(
    theme === 'light'
      ? 'settings.themeLight'
      : theme === 'dark'
        ? 'settings.themeDark'
        : 'settings.themeSystem',
  );
  const appearanceValue = `${themeLabel} · ${locale === 'en' ? 'English' : '中文'}`;
  const soundValue = soundEnabled
    ? `${t('settings.on')} · ${Math.round(soundVolume * 100)}%`
    : t('settings.off');
  const notificationsValue = !notifications
    ? t('settings.off')
    : onlyWhenAway
      ? t('settings.onlyWhenAwayShort')
      : t('settings.on');

  return (
    <SettingsPage topPad={insets.top} testID="settings-index">
      <View style={styles.head}>
        <Text style={[styles.title, { color: tokens.ink }]}>{t('settings.title')}</Text>
        <MutedText>{t('settings.indexHint')}</MutedText>
      </View>

      <Pressable
        testID="settings-nav-account"
        accessibilityRole="button"
        onPress={() => navigation.navigate('SettingsAccount')}
        style={({ pressed }) => [
          styles.account,
          {
            backgroundColor: pressed ? tokens.surface2 : tokens.surface,
            borderColor: tokens.line,
            shadowColor: tokens.ink,
          },
        ]}
      >
        <AccountAvatar name={user?.displayName ?? ''} url={user?.avatarUrl} size={44} />
        <View style={styles.accountText}>
          <Text style={[styles.accountName, { color: tokens.ink }]} numberOfLines={1}>
            {user?.displayName ?? t('settings.signedOut')}
          </Text>
          <Text style={[styles.accountSub, { color: tokens.inkSoft }]} numberOfLines={1}>
            {isGuest ? t('settings.guestAccount') : (user?.email ?? t('settings.memberAccount'))}
          </Text>
        </View>
        <ChevronRight size={18} color={tokens.inkSoft} />
      </Pressable>

      <SettingsGroup title={t('settings.playGroup')}>
        <NavRow
          first
          icon={Palette}
          testID="settings-nav-appearance"
          title={t('settings.appearance')}
          value={appearanceValue}
          onPress={() => navigation.navigate('SettingsAppearance')}
        />
        <NavRow
          icon={Volume2}
          testID="settings-nav-sound"
          title={t('settings.soundGroup')}
          value={soundValue}
          onPress={() => navigation.navigate('SettingsSound')}
        />
        <NavRow
          icon={Bell}
          testID="settings-nav-notifications"
          title={t('settings.notifications')}
          value={notificationsValue}
          onPress={() => navigation.navigate('SettingsNotifications')}
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.appGroup')}>
        <NavRow
          first
          icon={ShieldCheck}
          testID="settings-nav-privacy"
          title={t('settings.adsGroup')}
          onPress={() => navigation.navigate('SettingsPrivacy')}
        />
        {/* Not a pushed page: the help content IS the web app's /support page (one source for
            the FAQ + contact form, per app), opened in an in-app browser like the legal docs. */}
        <NavRow
          icon={LifeBuoy}
          testID="settings-nav-support"
          title={t('settings.support')}
          onPress={openSupport}
        />
        <NavRow
          icon={Info}
          testID="settings-nav-about"
          title={t('settings.about')}
          value={APP_VERSION}
          onPress={() => navigation.navigate('SettingsAbout')}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4, paddingHorizontal: 4 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: 0.5 },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  accountText: { flex: 1, gap: 2 },
  accountName: { fontSize: 16, fontWeight: '700' },
  accountSub: { fontSize: 12 },
});
