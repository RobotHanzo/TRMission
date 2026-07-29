// Finished games the user played in or spectated (ports the web HistoryScreen) — a departures
// board: one section per day, one service per game, the whole row opening the client-side replay
// player. Grouping by day is what makes a long history scannable: the date stops repeating on
// every line, and the time shrinks to a mono HH:MM in the margin where a timetable puts it.
// Opening a replay is feature-gated (replayReview) exactly like web; the server 403s regardless.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Play } from 'lucide-react-native';
import type { RootStackParamList } from '../navigation';
import { api, type MatchSummary } from '../net/rest';
import { useHasFeature, useSession } from '../store/session';
import { useUi } from '../store/ui';
import { seatColor } from '../theme/colors';
import { useTheme } from '../theme/useTheme';
import { ErrorText, MutedText } from '../theme/chrome';
import { DashedLeader } from '../theme/gameChrome';
import { useGlassHeaderPad } from '../hooks/useGlassHeaderPad';
import { AdBanner } from '../ads/AdBanner';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

/** Local calendar day, as a stable grouping key (not a label). */
const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Newest-first order arrives from the API; grouping must not disturb it. */
function groupByDay(rows: MatchSummary[]): { key: string; data: MatchSummary[] }[] {
  const sections: { key: string; data: MatchSummary[] }[] = [];
  for (const row of rows) {
    const key = dayKey(row.completedAt);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.data.push(row);
    else sections.push({ key, data: [row] });
  }
  return sections;
}

export function HistoryScreen({ navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const headerPad = useGlassHeaderPad();
  const canReplay = useHasFeature('replayReview');
  const user = useSession((s) => s.user);
  const locale = useUi((s) => s.locale);
  const [rows, setRows] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .history()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sections = useMemo(() => groupByDay(rows ?? []), [rows]);

  const nameOf = (p: MatchSummary['players'][number]): string =>
    p.userId === user?.id
      ? t('you')
      : p.displayName || (p.userId.startsWith('bot:') ? t('history.bot') : `P${p.seat + 1}`);

  // 24-hour clock regardless of locale convention: this is a timetable, and a column of
  // 下午09:04 / 9:04 PM neither aligns nor scans.
  const timeOf = (iso: string): string =>
    new Date(iso).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  const dayOf = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

  return (
    <View style={[styles.container, { backgroundColor: tokens.paper }]}>
      {/* Reserves room under the floating iOS Liquid Glass header (navigation.tsx); 0 on Android. */}
      {headerPad > 0 && <View style={{ height: headerPad }} />}
      {error && <ErrorText>{t('history.loadFailed')}</ErrorText>}
      {rows && rows.length === 0 && <MutedText center>{t('history.empty')}</MutedText>}
      <SectionList
        sections={sections}
        keyExtractor={(m) => m.gameId}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHead}>
            <Text style={[styles.dayTitle, { color: tokens.inkSoft }]}>
              {dayOf(section.data[0]!.completedAt)}
            </Text>
            <DashedLeader color={tokens.line} />
            <View style={[styles.dayCount, { backgroundColor: tokens.surface2 }]}>
              <Text style={[styles.dayCountText, { color: tokens.inkSoft }]}>
                {section.data.length}
              </Text>
            </View>
          </View>
        )}
        renderItem={({ item: m }) => {
          const scores = new Map((m.finalScores?.players ?? []).map((p) => [p.playerId, p.total]));
          const winners = m.players.filter((p) => m.winners.includes(p.userId));
          // One sentence of the whole row, so the row announces what it opens rather than a bag
          // of chips read left to right.
          const label = [
            t('history.watchReplay'),
            timeOf(m.completedAt),
            m.players.map(nameOf).join('、'),
            winners.length > 0 ? t('history.wonBy', { name: winners.map(nameOf).join('、') }) : '',
          ]
            .filter(Boolean)
            .join(' · ');
          const open = canReplay && m.replayable;

          return (
            <Pressable
              testID={`history-${m.gameId}`}
              accessibilityRole={canReplay ? 'button' : undefined}
              accessibilityLabel={canReplay ? label : undefined}
              accessibilityState={{ disabled: !open }}
              disabled={!open}
              onPress={() => navigation.navigate('Replay', { gameId: m.gameId })}
              style={[
                styles.row,
                {
                  backgroundColor: open || !canReplay ? tokens.surface : tokens.surface2,
                  borderColor: tokens.line,
                },
              ]}
            >
              <View style={styles.rowTop}>
                <Text style={[styles.time, { color: tokens.ink }]}>{timeOf(m.completedAt)}</Text>
                {/* Only the exception is worth a badge — "player" is what every other row is. */}
                {m.role === 'spectator' && (
                  <View style={[styles.role, { borderColor: tokens.line }]}>
                    <Text style={[styles.roleText, { color: tokens.inkSoft }]}>
                      {t('history.roleSpectator')}
                    </Text>
                  </View>
                )}
                <View style={styles.spacer} />
                {open && <Play size={14} color={tokens.inkSoft} />}
              </View>
              <View style={styles.players}>
                {m.players.map((p) => {
                  const won = m.winners.includes(p.userId);
                  const color = seatColor(p.seat);
                  return (
                    <View
                      key={p.userId}
                      style={[styles.chip, won && { backgroundColor: `${color}26` }]}
                    >
                      <View
                        style={[styles.livery, { backgroundColor: color }, won && styles.liveryWon]}
                      />
                      <Text
                        style={[
                          styles.chipName,
                          { color: won || p.userId === user?.id ? tokens.ink : tokens.inkSoft },
                          won && styles.chipNameWon,
                        ]}
                      >
                        {nameOf(p)}
                      </Text>
                      {scores.has(p.userId) && (
                        <Text
                          style={[styles.chipScore, { color: won ? tokens.ink : tokens.inkSoft }]}
                        >
                          {scores.get(p.userId)}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </Pressable>
          );
        }}
      />
      {/* A browse list, not a play surface — the one banner placement class (ads/AdBanner.tsx). */}
      <AdBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  list: { gap: 8, paddingBottom: 24 },

  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, paddingBottom: 4 },
  dayTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  dayCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCountText: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },

  row: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spacer: { flex: 1 },
  time: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  role: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  roleText: { fontSize: 11 },

  players: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 4,
    paddingRight: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  livery: { width: 3, height: 12, borderRadius: 1 },
  liveryWon: { height: 15 },
  chipName: { fontSize: 13 },
  chipNameWon: { fontWeight: '700' },
  chipScore: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
