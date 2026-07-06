import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RootStackParamList } from '../navigation';
import { api, type RoomView } from '../net/rest';
import { useSession } from '../store/session';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

/** The lobby home: rejoin an active room, create/join a room, or (P3) play offline vs bots. */
export function HomeScreen({ navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRooms(await api.getMyRooms());
    } catch {
      /* ignore — the rejoin list is best-effort */
    }
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => void refresh());
    return unsub;
  }, [navigation, refresh]);

  const createRoom = async (): Promise<void> => {
    setBusy(true);
    try {
      const room = await api.createRoom();
      navigation.navigate('Room', { code: room.code });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (): Promise<void> => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setBusy(true);
    try {
      const room = await api.joinRoom(trimmed);
      setCode('');
      navigation.navigate('Room', { code: room.code });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>{t('home.greeting', { name: user?.displayName ?? '' })}</Text>

      {rooms.length > 0 && (
        <>
          <Text style={styles.section}>{t('home.myRooms')}</Text>
          <FlatList
            data={rooms}
            keyExtractor={(r) => r.code}
            renderItem={({ item }) => (
              <Pressable
                style={styles.roomRow}
                onPress={() => navigation.navigate('Room', { code: item.code })}
              >
                <Text style={styles.roomCode}>{item.code}</Text>
                <Text style={styles.roomMeta}>
                  {t('home.playersCount', { n: item.members.length, max: item.maxPlayers })}
                </Text>
              </Pressable>
            )}
          />
        </>
      )}

      <View style={styles.joinRow}>
        <TextInput
          style={styles.joinInput}
          placeholder={t('home.joinPlaceholder')}
          autoCapitalize="characters"
          value={code}
          onChangeText={setCode}
          editable={!busy}
        />
        <Pressable style={styles.secondary} onPress={() => void joinRoom()} disabled={busy}>
          <Text style={styles.secondaryText}>{t('home.join')}</Text>
        </Pressable>
      </View>

      <Pressable style={styles.primary} onPress={() => void createRoom()} disabled={busy}>
        <Text style={styles.primaryText}>{t('home.create')}</Text>
      </Pressable>

      {/* P3 wires offline bot play here. */}
      <Pressable style={[styles.secondary, styles.disabled]} disabled>
        <Text style={styles.secondaryText}>{t('home.playBots')}</Text>
      </Pressable>

      <Pressable onPress={() => void signOut()}>
        <Text style={styles.signOut}>{t('home.signOut')}</Text>
      </Pressable>

      {__DEV__ && (
        <Pressable onPress={() => navigation.navigate('BoardSpike')}>
          <Text style={styles.devLink}>▶ board spike (dev)</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  greeting: { fontSize: 22, fontWeight: '700' },
  section: { fontSize: 13, fontWeight: '600', opacity: 0.6, marginTop: 8 },
  roomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 8,
  },
  roomCode: { fontSize: 16, fontWeight: '700' },
  roomMeta: { fontSize: 14, opacity: 0.6 },
  joinRow: { flexDirection: 'row', gap: 8 },
  joinInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  primary: { backgroundColor: '#1f6feb', borderRadius: 8, padding: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 16, fontWeight: '500' },
  disabled: { opacity: 0.4 },
  signOut: { textAlign: 'center', color: '#d33', marginTop: 8 },
  devLink: { textAlign: 'center', color: '#888', marginTop: 12, fontSize: 12 },
});
