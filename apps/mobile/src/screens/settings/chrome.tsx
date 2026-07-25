// The settings surfaces' shared primitives (issue #47). Settings is a grouped INDEX plus one
// pushed page per group (SettingsNavigator), so every page is built from the same three parts:
// a `SettingsPage` scaffold, `SettingsGroup` cards, and hairline-divided rows inside them.
//
// The signature element is the timetable leader borrowed from the game HUD (theme/gameChrome
// `TrayHead`) and the encyclopedia contents page: a dashed rule running from a name out to its
// value. On the index it does real work — every group states what it is currently set to, so
// the layer added by drilling down never hides an answer the reader came for.
import type { ComponentType, PropsWithChildren, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTabBarPad } from '../../hooks/useTabBarPad';
import { RADIUS, useTheme } from '../../theme/useTheme';
import { SectionLabel } from '../../theme/chrome';
import { DashedLeader } from '../../theme/gameChrome';

/** A lucide glyph, as passed to every row's `icon` prop (the component itself, not an element). */
export type RowIcon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/** Scroll scaffold shared by the index and every settings page. `topPad` is the index's notch
 *  inset or a pushed page's Liquid Glass header pad — the caller knows which it is. */
export function SettingsPage({
  children,
  topPad,
  testID,
}: PropsWithChildren<{ topPad: number; testID?: string }>) {
  const { tokens } = useTheme();
  const tabBarPad = useTabBarPad();
  return (
    <ScrollView
      testID={testID}
      style={{ backgroundColor: tokens.paper }}
      contentContainerStyle={[
        styles.page,
        { paddingTop: topPad + 16, paddingBottom: 40 + tabBarPad },
      ]}
    >
      {children}
    </ScrollView>
  );
}

/** A titled card of rows. Rows divide themselves with a hairline (see `SettingsRow`), so a group
 *  whose members are conditionally hidden still reads correctly. */
export function SettingsGroup({
  title,
  footnote,
  children,
}: PropsWithChildren<{ title?: string; footnote?: string }>) {
  const { tokens } = useTheme();
  return (
    <View style={styles.group}>
      {title != null && <SectionLabel>{title}</SectionLabel>}
      <View
        style={[
          styles.card,
          { backgroundColor: tokens.surface, borderColor: tokens.line, shadowColor: tokens.ink },
        ]}
      >
        {children}
      </View>
      {footnote != null && (
        <Text style={[styles.footnote, { color: tokens.inkSoft }]}>{footnote}</Text>
      )}
    </View>
  );
}

interface RowProps {
  label: string;
  /** Leading glyph. Takes the row's tone, so a destructive row's icon reads destructive too. */
  icon?: RowIcon;
  hint?: string;
  /** Right-hand control (a Switch) or value text. */
  trailing?: ReactNode;
  /** Makes the row pressable; without `trailing` it grows a chevron. */
  onPress?: () => void;
  /** Renders the label in the danger colour (sign out, delete account). */
  tone?: 'default' | 'link' | 'danger';
  /** Rows stack a hairline on top of everything after the first in a group. */
  first?: boolean;
  disabled?: boolean;
  testID?: string;
}

/** One cell in a group: label (+ hint) on the left, a control or value on the right. */
export function SettingsRow({
  label,
  icon: Icon,
  hint,
  trailing,
  onPress,
  tone = 'default',
  first = false,
  disabled = false,
  testID,
}: RowProps) {
  const { tokens } = useTheme();
  const color = tone === 'danger' ? tokens.danger : tone === 'link' ? tokens.blue : tokens.ink;
  const right = trailing ?? (onPress ? <ChevronRight size={16} color={tokens.inkSoft} /> : null);
  const body = (
    <>
      {Icon != null && (
        <RowGlyph>
          <Icon size={17} color={tone === 'default' ? tokens.inkSoft : color} strokeWidth={2} />
        </RowGlyph>
      )}
      <View style={styles.rowLabels}>
        <Text style={[styles.rowLabel, { color }]}>{label}</Text>
        {hint != null && <Text style={[styles.rowHint, { color: tokens.inkSoft }]}>{hint}</Text>}
      </View>
      {right}
    </>
  );
  const frame = [
    styles.row,
    !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.line },
    disabled && styles.dimmed,
  ];
  if (!onPress) {
    return (
      <View style={frame} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole={tone === 'link' ? 'link' : 'button'}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [...frame, pressed && { backgroundColor: tokens.surface2 }]}
    >
      {body}
    </Pressable>
  );
}

/** A row whose control is a set of exclusive chips, stacked under the label so long option
 *  labels (中文 / English, 右側欄 / 底部匣) never squeeze the title. */
export function ChoiceRow<T extends string>({
  label,
  icon: Icon,
  hint,
  options,
  value,
  onChange,
  testIDPrefix,
  first = false,
}: {
  label: string;
  icon?: RowIcon;
  hint?: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange(v: T): void;
  testIDPrefix?: string;
  first?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <View
      style={[
        styles.choice,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.line },
      ]}
    >
      <View style={styles.choiceHead}>
        {Icon != null && (
          <RowGlyph>
            <Icon size={17} color={tokens.inkSoft} strokeWidth={2} />
          </RowGlyph>
        )}
        <View style={styles.rowLabels}>
          <Text style={[styles.rowLabel, { color: tokens.ink }]}>{label}</Text>
          {hint != null && <Text style={[styles.rowHint, { color: tokens.inkSoft }]}>{hint}</Text>}
        </View>
      </View>
      {/* Hang the chips off the label, not the card edge, so the icon gutter stays a clean column. */}
      <View style={[styles.chips, Icon != null && styles.chipsIndented]}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined}
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
    </View>
  );
}

/** The index's departure row: badge — group name ── dashed leader ── what it is set to ›. */
export function NavRow({
  title,
  icon: Icon,
  value,
  onPress,
  first = false,
  testID,
}: {
  title: string;
  /** Category glyph, carried in a tinted badge so the index scans by shape as well as by name. */
  icon: RowIcon;
  /** Current setting, stated on the index so the drill-down hides nothing. */
  value?: string;
  onPress(): void;
  first?: boolean;
  testID?: string;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title} — ${value}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.line },
        pressed && { backgroundColor: tokens.surface2 },
      ]}
    >
      <View style={[styles.navBadge, { backgroundColor: tokens.surface2 }]}>
        <Icon size={17} color={tokens.blue} strokeWidth={2} />
      </View>
      <Text style={[styles.navTitle, { color: tokens.ink }]} numberOfLines={1}>
        {title}
      </Text>
      <DashedLeader color={tokens.line} />
      {value != null && (
        <Text style={[styles.navValue, { color: tokens.inkSoft }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      <ChevronRight size={16} color={tokens.inkSoft} />
    </Pressable>
  );
}

/** Right-aligned value text for a non-interactive row (version, commit). */
export function RowValue({ children }: PropsWithChildren) {
  const { tokens } = useTheme();
  return <Text style={[styles.navValue, { color: tokens.inkSoft }]}>{children}</Text>;
}

/** Fixed-width gutter for a row's leading glyph, so every label in a group starts on one line. */
function RowGlyph({ children }: PropsWithChildren) {
  return <View style={styles.rowGlyph}>{children}</View>;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 20, gap: 22 },
  group: { gap: 8 },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowLabels: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, lineHeight: 16 },
  rowGlyph: { width: 22, alignItems: 'center' },
  dimmed: { opacity: 0.45 },
  choice: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipsIndented: { paddingLeft: 34 }, // rowGlyph width + choiceHead gap
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 14,
  },
  navBadge: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { fontSize: 15, fontWeight: '700', flexShrink: 0 },
  navValue: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  footnote: { fontSize: 12, lineHeight: 17, paddingHorizontal: 4 },
});
