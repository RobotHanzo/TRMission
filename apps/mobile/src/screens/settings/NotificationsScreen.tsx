// Settings ▸ Notifications: the push opt-in, its quiet-while-playing rule (issue #48), and the
// iOS Live Activity. `NotificationsRow` and `LiveActivityRow` stay their own components — each
// owns a permission dance the others do not have.
import { useTranslation } from 'react-i18next';
import { Switch } from 'react-native';
import { MoonStar } from 'lucide-react-native';
import { isLiveActivitySupported } from '../../../modules/live-activity';
import { useGlassHeaderPad } from '../../hooks/useGlassHeaderPad';
import { useSettings } from '../../store/settings';
import { SettingsGroup, SettingsPage, SettingsRow } from './chrome';
import LiveActivityRow from './LiveActivityRow';
import NotificationsRow from './NotificationsRow';

export default function NotificationsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const headerPad = useGlassHeaderPad();
  const notifications = useSettings((s) => s.notifications);
  const onlyWhenAway = useSettings((s) => s.notifyOnlyWhenAway);
  const setOnlyWhenAway = useSettings((s) => s.setNotifyOnlyWhenAway);

  return (
    <SettingsPage topPad={headerPad} testID="settings-notifications">
      <SettingsGroup footnote={t('settings.notificationsFootnote')}>
        <NotificationsRow first />
        {/* Stays visible (dimmed) while push is off: a lone switch on a dedicated page reads as
            broken, and the rule is worth knowing about before you opt in. */}
        <SettingsRow
          icon={MoonStar}
          label={t('settings.onlyWhenAway')}
          hint={t('settings.onlyWhenAwayHint')}
          disabled={!notifications}
          trailing={
            <Switch
              testID="only-when-away-switch"
              value={onlyWhenAway}
              disabled={!notifications}
              onValueChange={setOnlyWhenAway}
            />
          }
        />
      </SettingsGroup>

      {/* iOS only: the whole group goes away where ActivityKit doesn't exist, so the page never
          advertises a surface this platform cannot show. */}
      {isLiveActivitySupported() && (
        <SettingsGroup>
          <LiveActivityRow first />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
