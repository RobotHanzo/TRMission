import { useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../store/settings';
import { ensurePushRegistration, unregisterDeviceForPush } from '../../push/register';

/** The push toggle: ON asks the OS (or routes to system settings when permanently denied),
 *  then registers the native token; OFF deregisters it. The setting only flips on success. */
export default function NotificationsRow(): React.JSX.Element {
  const { t } = useTranslation();
  const enabled = useSettings((s) => s.notifications);
  const setNotifications = useSettings((s) => s.setNotifications);
  const [busy, setBusy] = useState(false);

  const onToggle = async (next: boolean): Promise<void> => {
    setBusy(true);
    try {
      if (next) {
        const perm = await Notifications.requestPermissionsAsync();
        if (!perm.granted) {
          if (perm.canAskAgain === false) {
            // Permanently denied: the only path is the OS settings screen.
            Alert.alert(t('settings.pushDeniedTitle'), t('settings.pushDeniedBody'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('settings.openSystemSettings'),
                onPress: () => void Linking.openSettings(),
              },
            ]);
          }
          return; // toggle stays off
        }
        setNotifications(true);
        await ensurePushRegistration();
      } else {
        setNotifications(false);
        await unregisterDeviceForPush();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{t('settings.notifications')}</Text>
      <Switch
        testID="notifications-switch"
        value={enabled}
        disabled={busy}
        onValueChange={(v) => void onToggle(v)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  label: { fontSize: 15 },
});
