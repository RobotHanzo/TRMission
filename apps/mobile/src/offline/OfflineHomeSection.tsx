// Home's offline block: the Play-vs-Bots entry + the in-progress resume list. Injectable
// store for tests; defaults to the platform store (sqlite on device, in-memory on the web
// harness). Reloads whenever the screen regains focus (a finished/abandoned game must drop
// off the list).
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { officialMapById } from '@trm/map-data';
import { DepartureRow, PrimaryButton, SectionLabel } from '../theme/chrome';
import { useTheme } from '../theme/useTheme';
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
  const { tokens } = useTheme();
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

  const confirmRemove = (gameId: string): void => {
    Alert.alert(t('offline.deleteConfirmTitle'), t('offline.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('offline.delete'), style: 'destructive', onPress: () => void remove(gameId) },
    ]);
  };

  return (
    <View style={styles.section}>
      <PrimaryButton testID="offline-play-bots" title={t('home.playBots')} onPress={onNewGame} />

      {entries.length > 0 && (
        <View style={styles.list}>
          <SectionLabel>{t('home.resumeOffline')}</SectionLabel>
          {entries.map((e) => (
            <View key={e.gameId} style={styles.rowWrap}>
              <DepartureRow
                testID={`offline-resume-${e.gameId}`}
                style={styles.row}
                title={`${mapName(e.mapId)} · ${t('offline.botsN', { count: e.botCount })}`}
                desc={`${t('offline.inProgress')} · ${new Date(e.updatedAt).toLocaleString()}`}
                onPress={() => onResume(e.gameId)}
              />
              <Pressable
                testID={`offline-delete-${e.gameId}`}
                accessibilityRole="button"
                accessibilityLabel={t('offline.delete')}
                onPress={() => confirmRemove(e.gameId)}
                style={styles.delete}
              >
                <Text style={[styles.deleteText, { color: tokens.inkSoft }]}>×</Text>
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
  list: { gap: 8 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flex: 1 },
  delete: { padding: 10, minHeight: 44, justifyContent: 'center' },
  deleteText: { fontSize: 18 },
});
