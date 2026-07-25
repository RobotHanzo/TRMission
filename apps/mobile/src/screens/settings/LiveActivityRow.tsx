import { Switch } from 'react-native';
import { SquareActivity } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../store/settings';
import { isLiveActivitySupported } from '../../../modules/live-activity';
import { SettingsRow } from './chrome';

/**
 * The in-app opt-out for the in-game Live Activity (issue #43). Renders nothing where ActivityKit
 * doesn't exist (Android, the RNW harness, Expo Go), so it never advertises an iOS-only surface.
 *
 * No OS permission to ask for here — Live Activities are allowed unless the user switches them off
 * for the app in iOS Settings, which `areLiveActivitiesEnabled()` checks at start time. Hence a
 * plain toggle that defaults ON, unlike the push row next to it.
 */
export default function LiveActivityRow({ first }: { first?: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const enabled = useSettings((s) => s.liveActivities);
  const setLiveActivities = useSettings((s) => s.setLiveActivities);

  if (!isLiveActivitySupported()) return null;

  return (
    <SettingsRow
      first={first ?? false}
      icon={SquareActivity}
      label={t('settings.liveActivities')}
      hint={t('settings.liveActivitiesHint')}
      trailing={
        <Switch testID="live-activities-switch" value={enabled} onValueChange={setLiveActivities} />
      }
    />
  );
}
