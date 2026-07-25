import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../store/settings';
import { isLiveActivitySupported } from '../../../modules/live-activity';
import { useTheme } from '../../theme/useTheme';

/**
 * The in-app opt-out for the in-game Live Activity (issue #43). Renders nothing where ActivityKit
 * doesn't exist (Android, the RNW harness, Expo Go), so it never advertises an iOS-only surface.
 *
 * No OS permission to ask for here — Live Activities are allowed unless the user switches them off
 * for the app in iOS Settings, which `areLiveActivitiesEnabled()` checks at start time. Hence a
 * plain toggle that defaults ON, unlike the push row next to it.
 */
export default function LiveActivityRow(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const enabled = useSettings((s) => s.liveActivities);
  const setLiveActivities = useSettings((s) => s.setLiveActivities);

  if (!isLiveActivitySupported()) return null;

  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('settings.liveActivities')}</Text>
        <Text style={[styles.hint, { color: tokens.inkSoft }]}>
          {t('settings.liveActivitiesHint')}
        </Text>
      </View>
      <Switch testID="live-activities-switch" value={enabled} onValueChange={setLiveActivities} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
    paddingVertical: 6,
  },
  copy: { flex: 1 },
  label: { fontSize: 15 },
  hint: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
