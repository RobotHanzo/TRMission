import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import { showAdPrivacyOptions, useAds } from '../../ads/ads';
import { useTheme } from '../../theme/useTheme';

/**
 * Re-opens the UMP consent (privacy options) form.
 *
 * Renders **nothing** unless UMP reports `privacyOptionsRequirementStatus === REQUIRED` — i.e. this
 * user is in the EEA/UK or a regulated US state, where the law says a granted consent must stay
 * revocable. Elsewhere no form exists and `showPrivacyOptionsForm()` would simply fail, so a row
 * that never worked would be worse than no row. Same "hide when not applicable" shape as
 * `LiveActivityRow` off iOS.
 */
export default function AdPrivacyRow(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const required = useAds((s) => s.privacyOptionsRequired);
  if (!required) return null;
  return (
    <Pressable
      testID="settings-ad-privacy"
      accessibilityRole="button"
      style={styles.row}
      onPress={() => void showAdPrivacyOptions()}
    >
      <Text style={[styles.label, { color: tokens.blue }]}>{t('settings.adPrivacy')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  label: { fontSize: 15, fontWeight: '600' },
});
