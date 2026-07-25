// Settings ▸ About: what build this is, and the crash report a beta tester can hand a maintainer.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Share } from 'react-native';
import { GitCommitHorizontal, Tag, TriangleAlert } from 'lucide-react-native';
import { APP_VERSION, BUILD_NUMBER, GIT_COMMIT } from '../../config';
import { formatCrashReport, getLastCrash, type CrashRecord } from '../../app/crashCapture';
import { useGlassHeaderPad } from '../../hooks/useGlassHeaderPad';
import { RowValue, SettingsGroup, SettingsPage, SettingsRow } from './chrome';
import UpdateRow from './UpdateRow';

export default function AboutScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const headerPad = useGlassHeaderPad();

  // A persisted last-crash record (app/crashCapture.ts) makes an extra row appear so
  // TestFlight/beta testers can share the JS stack — the Apple crash log alone has no JS frames.
  const [lastCrash, setLastCrash] = useState<CrashRecord | null>(null);
  useEffect(() => {
    void getLastCrash().then(setLastCrash);
  }, []);
  const shareCrash = async (): Promise<void> => {
    if (!lastCrash) return;
    const report = formatCrashReport(lastCrash);
    try {
      await Share.share({ message: report });
    } catch {
      // Share sheet unavailable (RNW harness): fall back to an alert the tester can screenshot.
      Alert.alert(t('settings.crashReport'), report);
    }
  };

  return (
    <SettingsPage topPad={headerPad} testID="settings-about">
      <SettingsGroup>
        <SettingsRow
          first
          icon={Tag}
          label={t('settings.version')}
          trailing={<RowValue>{`${APP_VERSION} (${BUILD_NUMBER})`}</RowValue>}
        />
        <SettingsRow
          icon={GitCommitHorizontal}
          label={t('settings.commit')}
          trailing={<RowValue>{GIT_COMMIT.slice(0, 7)}</RowValue>}
        />
      </SettingsGroup>

      {/* Sits under the version rows because that is what it changes — the commit above becomes the
          published bundle's once an update applies. */}
      <SettingsGroup footnote={t('settings.updatesFootnote')}>
        <UpdateRow first />
      </SettingsGroup>

      {lastCrash && (
        <SettingsGroup footnote={t('settings.crashReportHint')}>
          <SettingsRow
            first
            tone="link"
            icon={TriangleAlert}
            testID="settings-crash-report"
            label={t('settings.crashReport')}
            onPress={() => void shareCrash()}
          />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
