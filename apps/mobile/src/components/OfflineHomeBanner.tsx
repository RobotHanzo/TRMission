// The Home screen's offline POSTURE banner (Apple 4.2 path): the device has no connectivity,
// online entries render disabled, offline play stays live. Distinct from components/OfflineBanner,
// the in-game socket-status strip.
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/useTheme';

export function OfflineHomeBanner() {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  return (
    <View
      style={[styles.banner, { backgroundColor: tokens.surface2, borderColor: tokens.line }]}
      accessibilityRole="alert"
    >
      <Text style={[styles.text, { color: tokens.inkSoft }]}>{t('offline.banner')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { fontSize: 13, textAlign: 'center' },
});
