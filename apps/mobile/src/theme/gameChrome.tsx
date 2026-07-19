// The game-stage HUD's shared visual primitives — the in-game counterpart of theme/chrome.tsx,
// porting the web game.css panel voice ("railway timetable on warm paper") to RN. The signature
// element is the timetable leader: the dashed rule running from a panel title to its count pill
// (web `.tray-head::after`), so every HUD panel reads as a timetable column head. Everything
// styles through the ChromeTokens palette; hardcoded hexes in game components are a bug.
import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { RADIUS, useTheme, type ChromeTokens } from './useTheme';

/** The timetable leader — a dashed rule filling the space between a title and its pill (web
 *  `repeating-linear-gradient(to right, line 0 6px, transparent 6px 10px)`). Drawn as clipped
 *  dash segments because RN's dashed borderStyle is unreliable on Android for single edges. */
export function DashedLeader({ color }: { color: string }) {
  return (
    <View style={styles.leader} accessibilityElementsHidden importantForAccessibility="no">
      {LEADER_DASHES.map((i) => (
        <View key={i} style={[styles.leaderDash, { backgroundColor: color }]} />
      ))}
    </View>
  );
}
// Enough 6+4dp dashes to overfill any rail/dock width; the clipped tail is free.
const LEADER_DASHES = Array.from({ length: 80 }, (_, i) => i);

/** The count pill every panel head hangs off its leader (web `.tray-count`). */
export function CountPill({ value }: { value: number | string }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.countPill, { backgroundColor: tokens.surface2 }]}>
      <Text style={[styles.countPillText, { color: tokens.inkSoft }]}>{value}</Text>
    </View>
  );
}

/** Timetable panel head: title ── dashed leader ── count pill (web `.tray-head`). */
export function TrayHead({
  title,
  count,
  right,
}: {
  title: string;
  count?: number | undefined;
  /** Extra trailing content after the pill (e.g. a header action). */
  right?: ReactNode;
}) {
  const { tokens } = useTheme();
  return (
    <View style={styles.trayHead}>
      <Text style={[styles.trayTitle, { color: tokens.ink }]}>{title}</Text>
      <DashedLeader color={tokens.line} />
      {count !== undefined && <CountPill value={count} />}
      {right}
    </View>
  );
}

/** The timetable sheet a HUD panel sits on (web `.tray-section`): warm surface, hairline border,
 *  soft paper shadow. */
export function GamePanel({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { tokens } = useTheme();
  return <View style={[panelCardStyle(tokens), style]}>{children}</View>;
}

/** The GamePanel surface as a plain style, for panels that need to stay a custom component. */
export function panelCardStyle(tokens: ChromeTokens): ViewStyle {
  return {
    backgroundColor: tokens.surface,
    borderColor: tokens.line,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 12,
    gap: 8,
    shadowColor: tokens.ink,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  };
}

const styles = StyleSheet.create({
  leader: {
    flex: 1,
    height: 1,
    flexDirection: 'row',
    gap: 4,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  leaderDash: { width: 6, height: 1 },
  trayHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trayTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  countPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
