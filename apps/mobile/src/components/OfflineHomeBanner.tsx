// The Home screen's offline POSTURE banner (Apple 4.2 path): the device has no connectivity,
// online entries render disabled, offline play stays live. Distinct from components/OfflineBanner,
// the in-game socket-status strip.
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

export function OfflineHomeBanner() {
  const { t } = useTranslation();
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>{t('offline.banner')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#555', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  text: { color: '#fff', fontSize: 13 },
});
