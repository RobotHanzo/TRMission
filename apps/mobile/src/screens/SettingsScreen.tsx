// Device + game settings (ports the web SettingsModal option lists) plus the store-mandated
// account controls (Apple 5.1.1(v) / Play): appearance, language, board layout, colour-blind
// glyphs, sound + volume, push toggle, haptics toggle, and in-app account deletion. Guests have
// no deletion row — a guest account holds nothing its TTL won't reap. Preference changes apply
// instantly (ui store persists on-device) and then sync to the account (no-op for guests).
import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { BoardLayout, Locale, Theme, UserPreferences } from '../net/rest';
import { APP_VERSION, BUILD_NUMBER, GIT_COMMIT, SERVER_ORIGIN } from '../config';
import { useSettings } from '../store/settings';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useTheme } from '../theme/useTheme';
import { MutedText, SectionLabel } from '../theme/chrome';
import { useTabBarPad } from '../hooks/useTabBarPad';
import { performAccountDeletion } from '../account/deleteAccount';
import { formatCrashReport, getLastCrash, type CrashRecord } from '../app/crashCapture';
import NotificationsRow from './settings/NotificationsRow';
import { VolumeSlider } from './settings/VolumeSlider';

/** A row of exclusive chips (same idiom as the lobby's Chips). */
function Chips<T extends string | number>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange(v: T): void;
  testIDPrefix?: string;
}) {
  const { tokens } = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            testID={testIDPrefix ? `${testIDPrefix}-${String(o.value)}` : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[
              styles.chip,
              { borderColor: on ? tokens.blue : tokens.line },
              on && { backgroundColor: `${tokens.blue}22` },
            ]}
          >
            <Text style={[styles.chipText, { color: on ? tokens.blue : tokens.ink }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  // Tab screens render full-bleed (no stack header, floating iOS tab bar): the notch row gets
  // hard padding; the bottom pad lives on the CONTENT so rows scroll out from under the glass bar.
  const insets = useSafeAreaInsets();
  const tabBarPad = useTabBarPad();
  const haptics = useSettings((s) => s.haptics);
  const setHaptics = useSettings((s) => s.setHaptics);
  const isGuest = useSession((s) => s.user?.isGuest ?? true);
  const savePreferences = useSession((s) => s.savePreferences);

  const theme = useUi((s) => s.theme);
  const locale = useUi((s) => s.locale);
  const colorBlind = useUi((s) => s.colorBlind);
  const boardLayout = useUi((s) => s.boardLayout);
  const soundEnabled = useUi((s) => s.soundEnabled);
  const soundVolume = useUi((s) => s.soundVolume);
  const setTheme = useUi((s) => s.setTheme);
  const setLocale = useUi((s) => s.setLocale);
  const setColorBlind = useUi((s) => s.setColorBlind);
  const setBoardLayout = useUi((s) => s.setBoardLayout);
  const setSoundEnabled = useUi((s) => s.setSoundEnabled);
  const setSoundVolume = useUi((s) => s.setSoundVolume);

  // Apply immediately for snappy feedback, then sync the full set to the account (guests
  // persist on-device only). Spreading current values keeps every preference in the payload.
  const persist = (patch: Partial<UserPreferences>): void =>
    void savePreferences({ theme, colorBlind, locale, boardLayout, ...patch }).catch(
      () => undefined,
    );

  // Crash-capture surface (see app/crashCapture.ts): a persisted last-crash record makes an
  // extra About row appear so TestFlight/beta testers can share the JS stack with a maintainer —
  // the Apple crash log alone has no JS frames.
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

  const runDelete = async (): Promise<void> => {
    const outcome = await performAccountDeletion();
    if (outcome === 'failed') Alert.alert(t('settings.deleteFailed'));
    // 'deleted' clears the session; the auth-gated navigator swaps to the login stack itself.
  };
  const confirmDelete = (): void => {
    Alert.alert(t('settings.deleteConfirmTitle'), t('settings.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteConfirmAction'),
        style: 'destructive',
        onPress: () => void runDelete(),
      },
    ]);
  };

  return (
    <ScrollView
      style={{ backgroundColor: tokens.paper, paddingTop: insets.top }}
      contentContainerStyle={[styles.container, { paddingBottom: 40 + tabBarPad }]}
    >
      <SectionLabel>{t('settings.appearance')}</SectionLabel>
      <Chips<Theme>
        options={[
          { value: 'system', label: t('settings.themeSystem') },
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') },
        ]}
        value={theme}
        onChange={(next) => {
          void setTheme(next);
          persist({ theme: next });
        }}
        testIDPrefix="theme"
      />

      <SectionLabel>{t('settings.language')}</SectionLabel>
      <Chips<Locale>
        options={[
          { value: 'zh-Hant', label: '中文' },
          { value: 'en', label: 'English' },
        ]}
        value={locale}
        onChange={(next) => {
          void setLocale(next);
          persist({ locale: next });
        }}
        testIDPrefix="locale"
      />

      <SectionLabel>{t('settings.layout')}</SectionLabel>
      <Chips<BoardLayout>
        options={[
          { value: 'rail', label: t('settings.layoutRail') },
          { value: 'tray', label: t('settings.layoutTray') },
        ]}
        value={boardLayout}
        onChange={(next) => {
          void setBoardLayout(next);
          persist({ boardLayout: next });
        }}
      />

      <View style={styles.row}>
        <View style={styles.rowLabels}>
          <Text style={[styles.label, { color: tokens.ink }]}>{t('settings.colorBlind')}</Text>
          <MutedText>{t('settings.colorBlindDesc')}</MutedText>
        </View>
        <Switch
          testID="colorblind-switch"
          value={colorBlind}
          onValueChange={(next) => {
            void setColorBlind(next);
            persist({ colorBlind: next });
          }}
        />
      </View>

      <View style={styles.row}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('settings.sound')}</Text>
        <Switch
          testID="sound-switch"
          value={soundEnabled}
          onValueChange={(next) => void setSoundEnabled(next)}
        />
      </View>
      {soundEnabled && (
        <>
          <SectionLabel>{t('settings.volume')}</SectionLabel>
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
        </>
      )}

      <NotificationsRow />
      <View style={styles.row}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('settings.haptics')}</Text>
        <Switch testID="haptics-switch" value={haptics} onValueChange={setHaptics} />
      </View>

      {/* Store compliance (Apple 5.1.1 / Play): the privacy policy must be reachable IN the app,
          not just from the store listing. Served by the same-origin web app. */}
      <SectionLabel>{t('settings.about')}</SectionLabel>
      <View style={styles.row}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('settings.version')}</Text>
        <MutedText>{`${APP_VERSION} (${BUILD_NUMBER})`}</MutedText>
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: tokens.ink }]}>{t('settings.commit')}</Text>
        <MutedText>{GIT_COMMIT.slice(0, 7)}</MutedText>
      </View>
      <Pressable
        testID="settings-privacy-policy"
        accessibilityRole="link"
        style={styles.row}
        onPress={() => void Linking.openURL(`${SERVER_ORIGIN}/privacy`)}
      >
        <Text style={[styles.label, { color: tokens.blue }]}>{t('settings.privacyPolicy')}</Text>
      </Pressable>
      {lastCrash && (
        <Pressable
          testID="settings-crash-report"
          accessibilityRole="button"
          style={styles.row}
          onPress={() => void shareCrash()}
        >
          <Text style={[styles.label, { color: tokens.blue }]}>{t('settings.crashReport')}</Text>
        </Pressable>
      )}

      {!isGuest && (
        <Pressable
          testID="settings-delete-account"
          accessibilityRole="button"
          style={styles.deleteRow}
          onPress={confirmDelete}
        >
          <Text style={[styles.deleteText, { color: tokens.danger }]}>
            {t('settings.deleteAccount')}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 8, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
  },
  rowLabels: { flexShrink: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  volumeValue: { fontSize: 13, fontWeight: '600', width: 40, textAlign: 'right' },
  deleteRow: { minHeight: 48, justifyContent: 'center', marginTop: 16 },
  deleteText: { fontSize: 15, fontWeight: '600' },
});
