// Device settings + the store-mandated account controls (Apple 5.1.1(v) / Play): push toggle,
// haptics toggle, and in-app account deletion. Guests have no deletion row — a guest account
// holds nothing its TTL won't reap.
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store/settings';
import { useSession } from '../store/session';
import { performAccountDeletion } from '../account/deleteAccount';
import NotificationsRow from './settings/NotificationsRow';

export function SettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const haptics = useSettings((s) => s.haptics);
  const setHaptics = useSettings((s) => s.setHaptics);
  const isGuest = useSession((s) => s.user?.isGuest ?? true);

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
    <View style={styles.container}>
      <NotificationsRow />
      <View style={styles.row}>
        <Text style={styles.label}>{t('settings.haptics')}</Text>
        <Switch testID="haptics-switch" value={haptics} onValueChange={setHaptics} />
      </View>
      {!isGuest && (
        <Pressable
          testID="settings-delete-account"
          accessibilityRole="button"
          style={styles.deleteRow}
          onPress={confirmDelete}
        >
          <Text style={styles.deleteText}>{t('settings.deleteAccount')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  label: { fontSize: 15 },
  deleteRow: { minHeight: 48, justifyContent: 'center', marginTop: 16 },
  deleteText: { color: '#d33', fontSize: 15, fontWeight: '600' },
});
