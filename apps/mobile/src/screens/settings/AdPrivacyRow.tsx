import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react-native';
import { showAdPrivacyOptions, useAds } from '../../ads/ads';
import { SettingsRow } from './chrome';

/**
 * Re-opens the UMP consent (privacy options) form.
 *
 * Renders **nothing** unless UMP reports `privacyOptionsRequirementStatus === REQUIRED` — i.e. this
 * user is in the EEA/UK or a regulated US state, where the law says a granted consent must stay
 * revocable. Elsewhere no form exists and `showPrivacyOptionsForm()` would simply fail, so a row
 * that never worked would be worse than no row. Same "hide when not applicable" shape as
 * `LiveActivityRow` off iOS.
 */
export default function AdPrivacyRow({ first }: { first?: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const required = useAds((s) => s.privacyOptionsRequired);
  if (!required) return null;
  return (
    <SettingsRow
      first={first ?? false}
      tone="link"
      icon={SlidersHorizontal}
      testID="settings-ad-privacy"
      label={t('settings.adPrivacy')}
      onPress={() => void showAdPrivacyOptions()}
    />
  );
}
