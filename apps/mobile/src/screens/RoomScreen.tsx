import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation';
import { api, type RoomView } from '../net/rest';
import { useSession } from '../store/session';

type Props = NativeStackScreenProps<RootStackParamList, 'Room'>;

/** Lobby room: members + readiness, host start. Polls the REST view (no realtime lobby plane in
 *  P1); when the room flips to STARTED it advances to the (placeholder) game screen. */
export function RoomScreen({ route, navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { code } = route.params;
  const user = useSession((s) => s.user);
  const [room, setRoom] = useState<RoomView | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getRoom(code);
      setRoom(r);
      if (r.status === 'STARTED') navigation.replace('Game', { roomCode: code });
    } catch {
      /* ignore transient errors; the next poll retries */
    }
  }, [code, navigation]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [load]);

  const me = room?.members.find((m) => m.userId === user?.id);
  const isHost = !!room && room.hostId === user?.id;
  const allReady = !!room && room.members.every((m) => m.ready || m.isBot);

  const toggleReady = async (): Promise<void> => {
    if (!me) return;
    await api.setReady(code, !me.ready).catch(() => undefined);
    void load();
  };
  const start = async (): Promise<void> => {
    await api.startRoom(code).catch(() => undefined);
    navigation.replace('Game', { roomCode: code });
  };
  const leave = async (): Promise<void> => {
    await api.leaveRoom(code).catch(() => undefined);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.code}>{t('room.code', { code })}</Text>
      <Text style={styles.section}>{t('room.members')}</Text>
      <FlatList
        data={room?.members ?? []}
        keyExtractor={(m) => m.userId}
        renderItem={({ item }) => (
          <View style={styles.memberRow}>
            <Text style={styles.memberName}>
              {item.displayName}
              {item.userId === room?.hostId ? ` · ${t('room.host')}` : ''}
            </Text>
            <Text style={item.ready || item.isBot ? styles.readyOn : styles.readyOff}>
              {item.ready || item.isBot ? t('room.ready') : t('room.notReady')}
            </Text>
          </View>
        )}
      />

      <Pressable style={styles.secondary} onPress={() => void toggleReady()}>
        <Text style={styles.secondaryText}>{me?.ready ? t('room.notReady') : t('room.ready')}</Text>
      </Pressable>

      {isHost && (
        <Pressable
          style={[styles.primary, !allReady && styles.disabled]}
          onPress={() => void start()}
          disabled={!allReady}
        >
          <Text style={styles.primaryText}>{t('room.start')}</Text>
        </Pressable>
      )}

      <Pressable onPress={() => void leave()}>
        <Text style={styles.leave}>{t('room.leave')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  code: { fontSize: 22, fontWeight: '700' },
  section: { fontSize: 13, fontWeight: '600', opacity: 0.6 },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  memberName: { fontSize: 16 },
  readyOn: { color: '#2a7', fontWeight: '600' },
  readyOff: { color: '#999' },
  secondary: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 16, fontWeight: '500' },
  primary: { backgroundColor: '#0f5fa6', borderRadius: 8, padding: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  leave: { textAlign: 'center', color: '#d33', marginTop: 8 },
});
