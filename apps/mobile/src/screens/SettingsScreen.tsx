// Device + game settings (ports the web SettingsModal option lists) plus the store-mandated
// account controls (Apple 5.1.1(v) / Play): appearance, language, board layout, colour-blind
// glyphs, sound + volume, push toggle, haptics toggle, and in-app account deletion. Guests have
// no deletion row — a guest account holds nothing its TTL won't reap. Preference changes apply
// instantly (ui store persists on-device) and then sync to the account (no-op for guests).
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { BoardLayout, Locale, Theme, UserPreferences } from '../net/rest';
import { SERVER_ORIGIN } from '../config';
import { useSettings } from '../store/settings';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useTheme } from '../theme/useTheme';
import { MutedText, SectionLabel } from '../theme/chrome';
import { useTabBarPad } from '../hooks/useTabBarPad';
import { performAccountDeletion } from '../account/deleteAccount';
import NotificationsRow from './settings/NotificationsRow';

const VOLUME_STEPS = [0.25, 0.5, 0.75, 1] as const;

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
          <Chips<number>
            options={VOLUME_STEPS.map((v) => ({ value: v, label: `${Math.round(v * 100)}%` }))}
            value={VOLUME_STEPS.reduce((best, v) =>
              Math.abs(v - soundVolume) < Math.abs(best - soundVolume) ? v : best,
            )}
            onChange={(next) => void setSoundVolume(next)}
          />
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
      <Pressable
        testID="settings-privacy-policy"
        accessibilityRole="link"
        style={styles.row}
        onPress={() => void Linking.openURL(`${SERVER_ORIGIN}/privacy`)}
      >
        <Text style={[styles.label, { color: tokens.blue }]}>{t('settings.privacyPolicy')}</Text>
      </Pressable>

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
  deleteRow: { minHeight: 48, justifyContent: 'center', marginTop: 16 },
  deleteText: { fontSize: 15, fontWeight: '600' },
});
