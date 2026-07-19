// Home's offline block: the Play-vs-Bots entry + the in-progress resume list. Injectable
// store for tests; defaults to the platform store (sqlite on device, in-memory on the web
// harness). Reloads whenever the screen regains focus (a finished/abandoned game must drop
// off the list).
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { officialMapById } from '@trm/map-data';
import { openLocalGameStore } from './localStore';
import type { LocalGameStorePort, OfflineGameListEntry } from './types';

export interface OfflineHomeSectionProps {
  onNewGame(): void;
  onResume(gameId: string): void;
  /** Test seam; on-device callers omit it. */
  store?: LocalGameStorePort;
}

export function OfflineHomeSection({ onNewGame, onResume, store }: OfflineHomeSectionProps) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [entries, setEntries] = useState<OfflineGameListEntry[]>([]);

  const reload = useCallback(async () => {
    const s = store ?? (await openLocalGameStore());
    const all = await s.listGames();
    setEntries(all.filter((e) => e.status === 'LIVE'));
  }, [store]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const mapName = (mapId: string): string => {
    const m = officialMapById(mapId);
    return m ? (zh ? m.content.meta.nameZh : m.content.meta.nameEn) : mapId;
  };

  const remove = async (gameId: string): Promise<void> => {
    const s = store ?? (await openLocalGameStore());
    await s.deleteGame(gameId);
    await reload();
  };

  return (
    <View style={styles.section}>
      <Pressable
        testID="offline-play-bots"
        accessibilityRole="button"
        style={styles.play}
        onPress={onNewGame}
      >
        <Text style={styles.playText}>{t('home.playBots')}</Text>
      </Pressable>

      {entries.length > 0 && (
        <View style={styles.list}>
          <Text style={styles.listTitle}>{t('home.resumeOffline')}</Text>
          {entries.map((e) => (
            <View key={e.gameId} style={styles.rowWrap}>
              <Pressable
                testID={`offline-resume-${e.gameId}`}
                accessibilityRole="button"
                style={styles.row}
                onPress={() => onResume(e.gameId)}
              >
                <Text style={styles.rowTitle}>
                  {mapName(e.mapId)} · {t('offline.botsN', { count: e.botCount })}
                </Text>
                <Text style={styles.rowSub}>
                  {t('offline.inProgress')} · {new Date(e.updatedAt).toLocaleString()}
                </Text>
              </Pressable>
              <Pressable
                testID={`offline-delete-${e.gameId}`}
                accessibilityRole="button"
                accessibilityLabel={t('offline.delete')}
                onPress={() => void remove(e.gameId)}
                style={styles.delete}
              >
                <Text style={styles.deleteText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  play: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#0f5fa6',
    alignItems: 'center',
    minHeight: 44,
  },
  playText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  list: { gap: 8 },
  listTitle: { fontSize: 14, opacity: 0.7 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.25)' },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, opacity: 0.6, marginTop: 2 },
  delete: { padding: 10, minHeight: 44, justifyContent: 'center' },
  deleteText: { fontSize: 18, opacity: 0.6 },
});
