// Settings ▸ Sound & haptics. Both are per-device (never account-synced): the volume that suits
// headphones on a commute is not the one that suits a table at home.
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Vibrate, Volume1, Volume2 } from 'lucide-react-native';
import { useGlassHeaderPad } from '../../hooks/useGlassHeaderPad';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { useTheme } from '../../theme/useTheme';
import { SettingsGroup, SettingsPage, SettingsRow } from './chrome';
import { VolumeSlider } from './VolumeSlider';

export default function SoundScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const headerPad = useGlassHeaderPad();
  const soundEnabled = useUi((s) => s.soundEnabled);
  const soundVolume = useUi((s) => s.soundVolume);
  const setSoundEnabled = useUi((s) => s.setSoundEnabled);
  const setSoundVolume = useUi((s) => s.setSoundVolume);
  const haptics = useSettings((s) => s.haptics);
  const setHaptics = useSettings((s) => s.setHaptics);

  return (
    <SettingsPage topPad={headerPad} testID="settings-sound">
      <SettingsGroup title={t('settings.sound')}>
        <SettingsRow
          first
          icon={Volume2}
          label={t('settings.sound')}
          trailing={
            <Switch
              testID="sound-switch"
              value={soundEnabled}
              onValueChange={(next) => void setSoundEnabled(next)}
            />
          }
        />
        {soundEnabled && (
          <View style={[styles.volume, { borderTopColor: tokens.line }]}>
            <View style={styles.volumeHead}>
              <View style={styles.glyph}>
                <Volume1 size={17} color={tokens.inkSoft} strokeWidth={2} />
              </View>
              <Text style={[styles.label, { color: tokens.ink }]}>{t('settings.volume')}</Text>
            </View>
            <View style={styles.volumeRow}>
              <VolumeSlider
                testID="volume-slider"
                accessibilityLabel={t('settings.volume')}
                value={soundVolume}
                onChange={(next) => void setSoundVolume(next)}
              />
              <Text style={[styles.volumeValue, { color: tokens.inkSoft }]}>
                {Math.round(soundVolume * 100)}%
              </Text>
            </View>
          </View>
        )}
      </SettingsGroup>

      <SettingsGroup title={t('settings.hapticsGroup')} footnote={t('settings.hapticsHint')}>
        <SettingsRow
          first
          icon={Vibrate}
          label={t('settings.haptics')}
          trailing={<Switch testID="haptics-switch" value={haptics} onValueChange={setHaptics} />}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  volume: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  volumeHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  glyph: { width: 22, alignItems: 'center' },
  label: { fontSize: 15, fontWeight: '600' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  volumeValue: { fontSize: 13, fontWeight: '600', width: 40, textAlign: 'right' },
});
