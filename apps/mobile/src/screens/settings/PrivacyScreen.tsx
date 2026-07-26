// Settings ▸ Ads & privacy. Two of the three rows only exist for some accounts/regions, so the
// screen — not the rows — decides which one leads the group and skips the divider.
import { useTranslation } from 'react-i18next';
import { Switch } from 'react-native';
import { FileText, Megaphone, Scale } from 'lucide-react-native';
import { openLegalDoc } from '../../legal';
import { useAds } from '../../ads/ads';
import { useGlassHeaderPad } from '../../hooks/useGlassHeaderPad';
import { useHasFeature } from '../../store/session';
import { useUi } from '../../store/ui';
import AdPrivacyRow from './AdPrivacyRow';
import { SettingsGroup, SettingsPage, SettingsRow } from './chrome';

export default function PrivacyScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const headerPad = useGlassHeaderPad();
  // The ad opt-out only appears for accounts granted `adFree` from the maintainer dashboard —
  // and `useAdsVisible` enforces that independently, so the stored flag alone can never hide ads.
  const canHideAds = useHasFeature('adFree');
  const adPrivacyRequired = useAds((s) => s.privacyOptionsRequired);
  const hideAds = useUi((s) => s.hideAds);
  const setHideAds = useUi((s) => s.setHideAds);

  return (
    <SettingsPage topPad={headerPad} testID="settings-privacy">
      {/* No group title — the pushed header already says "Ads & privacy". */}
      <SettingsGroup footnote={t('settings.adsFootnote')}>
        {canHideAds && (
          <SettingsRow
            first
            icon={Megaphone}
            label={t('settings.hideAds')}
            hint={t('settings.hideAdsDesc')}
            trailing={
              <Switch
                testID="hide-ads-switch"
                value={hideAds}
                onValueChange={(v) => void setHideAds(v)}
              />
            }
          />
        )}
        {adPrivacyRequired && <AdPrivacyRow first={!canHideAds} />}
        {/* Store compliance (Apple 5.1.1 / Play): the policy must be reachable IN the app, not
            just from the store listing. Served by the web app on the same origin. */}
        <SettingsRow
          first={!canHideAds && !adPrivacyRequired}
          tone="link"
          icon={FileText}
          testID="settings-privacy-policy"
          label={t('settings.privacyPolicy')}
          onPress={() => openLegalDoc('privacy')}
        />
        {/* The other half of what sign-in agreed to (issue #51) — same page the login notice links. */}
        <SettingsRow
          tone="link"
          icon={Scale}
          testID="settings-terms"
          label={t('settings.termsOfService')}
          onPress={() => openLegalDoc('terms')}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
