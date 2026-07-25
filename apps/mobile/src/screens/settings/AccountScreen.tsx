// Settings ▸ Account: who you are signed in as, sign out, and the store-mandated in-app account
// deletion (Apple 5.1.1(v) / Play). Guests get no deletion row — a guest account holds nothing
// its TTL won't reap, and there is no credential to take back.
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { LogOut, Trash2 } from 'lucide-react-native';
import { performAccountDeletion } from '../../account/deleteAccount';
import { useGlassHeaderPad } from '../../hooks/useGlassHeaderPad';
import { useSession } from '../../store/session';
import { useTheme } from '../../theme/useTheme';
import { SettingsGroup, SettingsPage, SettingsRow } from './chrome';
import { AccountAvatar } from './identity';

export default function AccountScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const headerPad = useGlassHeaderPad();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const isGuest = user?.isGuest ?? true;

  const runDelete = async (): Promise<void> => {
    const outcome = await performAccountDeletion();
    if (outcome === 'failed') Alert.alert(t('settings.deleteFailed'));
    // 'deleted' clears the session; the auth-gated navigator swaps to the login stack itself.
  };
  const confirmDelete = (): void => {
    Alert.alert(t('settings.deleteConfirmTitle'), t('settings.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteConfirmAction'),
        style: 'destructive',
        onPress: () => void runDelete(),
      },
    ]);
  };

  return (
    <SettingsPage topPad={headerPad} testID="settings-account">
      <View style={styles.identity}>
        <AccountAvatar name={user?.displayName ?? ''} url={user?.avatarUrl} size={56} />
        <View style={styles.identityText}>
          <Text style={[styles.name, { color: tokens.ink }]} numberOfLines={1}>
            {user?.displayName ?? t('settings.signedOut')}
          </Text>
          <Text style={[styles.sub, { color: tokens.inkSoft }]} numberOfLines={1}>
            {isGuest ? t('settings.guestAccount') : (user?.email ?? t('settings.memberAccount'))}
          </Text>
        </View>
      </View>

      <SettingsGroup footnote={isGuest ? t('settings.guestFootnote') : undefined}>
        <SettingsRow
          first
          tone="danger"
          icon={LogOut}
          testID="settings-sign-out"
          label={t('settings.signOut')}
          onPress={() => void signOut()}
        />
      </SettingsGroup>

      {!isGuest && (
        <SettingsGroup footnote={t('settings.deleteFootnote')}>
          <SettingsRow
            first
            tone="danger"
            icon={Trash2}
            testID="settings-delete-account"
            label={t('settings.deleteAccount')}
            onPress={confirmDelete}
          />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4 },
  identityText: { flexShrink: 1, gap: 3 },
  name: { fontSize: 20, fontWeight: '700' },
  sub: { fontSize: 13 },
});
