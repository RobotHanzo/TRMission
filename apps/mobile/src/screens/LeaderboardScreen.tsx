// Player leaderboard: rating (main "ranking points" board), wins, and games-played, each
// all-time or this season (ports the web LeaderboardScreen). Registered users only —
// guests/bots never appear as rows.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  api,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardScopeKind,
} from '../net/rest';
import { useSession } from '../store/session';
import { useTheme } from '../theme/useTheme';
import { ErrorText, MutedText } from '../theme/chrome';
import { useTabBarPad } from '../hooks/useTabBarPad';

const SCOPES: LeaderboardScopeKind[] = ['allTime', 'season'];
const METRICS: LeaderboardMetric[] = ['rating', 'wins', 'gamesPlayed'];
const METRIC_KEY: Record<LeaderboardMetric, string> = {
  rating: 'leaderboard.metricRating',
  wins: 'leaderboard.metricWins',
  gamesPlayed: 'leaderboard.metricGamesPlayed',
};

export function LeaderboardScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  // Tab screens render full-bleed (no stack header, floating iOS tab bar): the notch row gets
  // hard padding; the list instead pads its CONTENT so rows scroll out from under the glass bar.
  const insets = useSafeAreaInsets();
  const tabBarPad = useTabBarPad();
  const user = useSession((s) => s.user);
  const [scope, setScope] = useState<LeaderboardScopeKind>('allTime');
  const [metric, setMetric] = useState<LeaderboardMetric>('rating');
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [mine, setMine] = useState<LeaderboardEntry | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(
    (append: string | null) => {
      setError(false);
      Promise.all([
        api.leaderboard({ scope, metric, ...(append ? { cursor: append } : {}) }),
        append ? null : api.myLeaderboardStanding({ scope, metric }),
      ])
        .then(([page, standing]) => {
          setRows((prev) => (append ? [...(prev ?? []), ...page.rows] : page.rows));
          setCursor(page.nextCursor);
          if (!append) setMine(standing?.standing ?? null);
        })
        .catch(() => setError(true));
    },
    [scope, metric],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  const metricValue = (r: LeaderboardEntry): number =>
    metric === 'rating' ? r.rating : metric === 'wins' ? r.wins : r.gamesPlayed;

  const inVisiblePage = !!user && !!rows?.some((r) => r.userId === user.id);

  const tab = (active: boolean) => [
    styles.tabBtn,
    { borderColor: tokens.line },
    active && { backgroundColor: tokens.blue },
  ];
  const tabText = (active: boolean) => [
    styles.tabText,
    { color: active ? '#fff' : tokens.inkSoft },
  ];

  return (
    <View
      style={[styles.container, { backgroundColor: tokens.paper, paddingTop: insets.top + 16 }]}
    >
      <View style={styles.tabRow}>
        {SCOPES.map((s) => (
          <Pressable
            key={s}
            accessibilityRole="button"
            style={tab(scope === s)}
            onPress={() => setScope(s)}
          >
            <Text style={tabText(scope === s)}>
              {t(s === 'allTime' ? 'leaderboard.scopeAllTime' : 'leaderboard.scopeSeason')}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.tabRow}>
        {METRICS.map((m) => (
          <Pressable
            key={m}
            accessibilityRole="button"
            style={tab(metric === m)}
            onPress={() => setMetric(m)}
          >
            <Text style={tabText(metric === m)}>{t(METRIC_KEY[m])}</Text>
          </Pressable>
        ))}
      </View>

      {error && <ErrorText>{t('leaderboard.loadFailed')}</ErrorText>}
      {rows && rows.length === 0 && <MutedText center>{t('leaderboard.empty')}</MutedText>}
      {user && !mine && rows && rows.length > 0 && (
        <MutedText center>{t('leaderboard.notRankedYet')}</MutedText>
      )}

      <FlatList
        data={rows ?? []}
        keyExtractor={(r) => r.userId}
        contentContainerStyle={[styles.list, { paddingBottom: 24 + tabBarPad }]}
        ListHeaderComponent={
          mine && !inVisiblePage ? (
            <View
              style={[
                styles.row,
                styles.rowMine,
                { backgroundColor: tokens.surface2, borderColor: tokens.blue },
              ]}
            >
              <Text style={[styles.rank, { color: tokens.inkSoft }]}>#{mine.rank}</Text>
              <Text style={[styles.name, { color: tokens.ink }]} numberOfLines={1}>
                {mine.displayName ?? t('leaderboard.you')} · {t('leaderboard.you')}
              </Text>
              <Text style={[styles.value, { color: tokens.ink }]}>{metricValue(mine)}</Text>
            </View>
          ) : null
        }
        renderItem={({ item: r }) => {
          const isMine = !!user && r.userId === user.id;
          return (
            <View
              style={[
                styles.row,
                isMine && styles.rowMine,
                { backgroundColor: tokens.surface, borderColor: tokens.line },
              ]}
              testID={`leaderboard-${r.userId}`}
            >
              <Text style={[styles.rank, { color: tokens.inkSoft }]}>#{r.rank}</Text>
              <Text style={[styles.name, { color: tokens.ink }]} numberOfLines={1}>
                {r.displayName ?? r.userId}
              </Text>
              <Text style={[styles.value, { color: tokens.ink }]}>{metricValue(r)}</Text>
            </View>
          );
        }}
        ListFooterComponent={
          cursor ? (
            <Pressable
              accessibilityRole="button"
              style={[styles.loadMoreBtn, { borderColor: tokens.line }]}
              onPress={() => load(cursor)}
            >
              <Text style={{ color: tokens.blue }}>{t('leaderboard.loadMore')}</Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  tabRow: { flexDirection: 'row', gap: 8 },
  tabBtn: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  tabText: { fontSize: 13, fontWeight: '700' },
  list: { gap: 8, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  rowMine: { borderWidth: 2 },
  rank: { fontSize: 13, fontWeight: '700', minWidth: 36 },
  name: { flex: 1, fontSize: 14, fontWeight: '600' },
  value: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  loadMoreBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
});
