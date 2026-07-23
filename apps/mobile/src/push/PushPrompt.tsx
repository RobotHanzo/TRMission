import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme/useTheme';
import { registerDeviceForPush } from './register';
import { Notifications } from './expoNotifications';

/**
 * Contextual permission ask (spec §5): shown in the game-over panel after the player's
 * FIRST finished game — the moment "get told when it's your turn" is self-explanatory.
 * Never shown at boot; never shown twice.
 */
export default function PushPrompt(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const seen = useSettings((s) => s.pushPromptSeen);
  const markSeen = useSettings((s) => s.markPushPromptSeen);
  const setNotifications = useSettings((s) => s.setNotifications);
  if (seen) return null;

  const accept = async (): Promise<void> => {
    markSeen();
    if (!Notifications) return; // Expo Go: push unavailable until a real dev/production build
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return; // fully functional without push; alerts stay in-app only
    setNotifications(true);
    await registerDeviceForPush();
  };

  return (
    <View style={styles.card}>
      <Text style={[styles.title, { color: tokens.ink }]}>{t('push.promptTitle')}</Text>
      <Text style={[styles.body, { color: tokens.inkSoft }]}>{t('push.promptBody')}</Text>
      <View style={styles.row}>
        <Pressable
          testID="push-prompt-dismiss"
          accessibilityRole="button"
          hitSlop={8}
          onPress={markSeen}
        >
          <Text style={[styles.dismiss, { color: tokens.inkSoft }]}>
            {t('push.promptDismiss')}
          </Text>
        </Pressable>
        <Pressable
          testID="push-prompt-accept"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => void accept()}
        >
          <Text style={[styles.accept, { color: tokens.blue }]}>{t('push.promptAccept')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, gap: 8, backgroundColor: 'rgba(127,127,127,0.12)' },
  title: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 13, opacity: 0.75 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 4 },
  dismiss: { opacity: 0.6 },
  accept: { fontWeight: '600' },
});
