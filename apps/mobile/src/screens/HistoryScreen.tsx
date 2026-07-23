// Finished games the user played in or spectated (ports the web HistoryScreen) — each
// replayable row opens the client-side replay player. The watch button is feature-gated
// (replayReview) exactly like web; the server 403s regardless.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Play } from 'lucide-react-native';
import type { RootStackParamList } from '../navigation';
import { api, type MatchSummary } from '../net/rest';
import { useHasFeature } from '../store/session';
import { useUi } from '../store/ui';
import { useTheme } from '../theme/useTheme';
import { ErrorText, MutedText } from '../theme/chrome';
import { useGlassHeaderPad } from '../hooks/useGlassHeaderPad';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

export function HistoryScreen({ navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const headerPad = useGlassHeaderPad();
  const canReplay = useHasFeature('replayReview');
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

  const nameOf = (p: MatchSummary['players'][number]): string =>
    p.displayName || (p.userId.startsWith('bot:') ? t('history.bot') : `P${p.seat + 1}`);

  return (
    <View style={[styles.container, { backgroundColor: tokens.paper }]}>
      {/* Reserves room under the floating iOS Liquid Glass header (navigation.tsx); 0 on Android. */}
      {headerPad > 0 && <View style={{ height: headerPad }} />}
      {error && <ErrorText>{t('history.loadFailed')}</ErrorText>}
      {rows && rows.length === 0 && <MutedText center>{t('history.empty')}</MutedText>}
      <FlatList
        data={rows ?? []}
        keyExtractor={(m) => m.gameId}
        contentContainerStyle={styles.list}
        renderItem={({ item: m }) => (
          <View
            style={[styles.row, { backgroundColor: tokens.surface, borderColor: tokens.line }]}
            testID={`history-${m.gameId}`}
          >
            <View style={styles.meta}>
              <Text style={[styles.date, { color: tokens.ink }]}>
                {new Date(m.completedAt).toLocaleString(locale)}
              </Text>
              <Text style={[styles.role, { color: tokens.inkSoft }]}>
                {t(m.role === 'player' ? 'history.rolePlayer' : 'history.roleSpectator')}
              </Text>
            </View>
            <Text style={[styles.players, { color: tokens.inkSoft }]} numberOfLines={2}>
              {m.players
                .map((p) => (m.winners.includes(p.userId) ? `👑 ${nameOf(p)}` : nameOf(p)))
                .join(' · ')}
            </Text>
            {canReplay && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !m.replayable }}
                disabled={!m.replayable}
                style={[
                  styles.watchBtn,
                  { borderColor: tokens.line },
                  !m.replayable && styles.disabled,
                ]}
                onPress={() => navigation.navigate('Replay', { gameId: m.gameId })}
              >
                <Play size={14} color={tokens.blue} />
                <Text style={[styles.watchText, { color: tokens.blue }]}>
                  {m.replayable ? t('history.watchReplay') : t('history.notReplayable')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  list: { gap: 8, paddingBottom: 24 },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 13, fontWeight: '700' },
  role: { fontSize: 12, fontWeight: '600' },
  players: { fontSize: 13 },
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 40,
    paddingHorizontal: 10,
  },
  watchText: { fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
