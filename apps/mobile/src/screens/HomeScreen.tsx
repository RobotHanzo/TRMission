import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation';
import { api, type RoomView } from '../net/rest';
import { useSession } from '../store/session';
import { useOnline } from '../hooks/useOnline';
import { OfflineHomeBanner } from '../components/OfflineHomeBanner';
import { OfflineHomeSection } from '../offline/OfflineHomeSection';
import { getTutorialCompletion } from '../features/tutorial/progress';
import { useCanBuild } from './BuilderScreen';
import {
  BrandWordmark,
  Field,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionLabel,
} from '../theme/chrome';
import { RADIUS, SPACE, useTheme } from '../theme/useTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

/** The lobby home: play offline vs bots, rejoin an active room, or create/join a room. */
export function HomeScreen({ navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const online = useOnline();
  const canBuild = useCanBuild();
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [publicRooms, setPublicRooms] = useState<RoomView[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Bumped on focus so the offline section remounts and reloads its resume list (a finished or
  // abandoned game must drop off it when the user navigates back here).
  const [focusKey, setFocusKey] = useState(0);
  // Loaded on focus: returning from the tutorial's finale must light the badge immediately.
  const [tutorialDone, setTutorialDone] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRooms(await api.getMyRooms());
    } catch {
      /* ignore — the rejoin list is best-effort */
    }
    try {
      setPublicRooms(await api.getPublicRooms());
    } catch {
      /* best-effort too */
    }
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      void refresh();
      setFocusKey((k) => k + 1);
      void getTutorialCompletion().then((c) => setTutorialDone(c !== null));
    });
    return unsub;
  }, [navigation, refresh]);

  // The public-rooms list stays fresh while the screen is up (web polls the same 5s cadence).
  useEffect(() => {
    if (!online) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [online, refresh]);

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

  const rowStyle = ({ pressed }: { pressed: boolean }) => [
    styles.roomRow,
    { backgroundColor: tokens.surface, borderColor: tokens.line },
    pressed && styles.pressed,
  ];

  return (
    <Screen style={styles.container}>
      <View style={styles.header}>
        <BrandWordmark />
        <Text style={[styles.greeting, { color: tokens.ink }]}>
          {t('home.greeting', { name: user?.displayName ?? '' })}
        </Text>
      </View>

      {!online && <OfflineHomeBanner />}

      {/* Offline play never gates on connectivity (Apple 4.2 posture). */}
      <OfflineHomeSection
        key={focusKey}
        onNewGame={() => navigation.navigate('OfflineSetup')}
        onResume={(gameId) => navigation.navigate('OfflineGame', { mode: 'resume', gameId })}
      />

      {/* The tutorial is fully offline too — never gated on connectivity or an account. */}
      <Pressable
        accessibilityRole="button"
        testID="home-tutorial"
        style={rowStyle}
        onPress={() => navigation.navigate('Tutorial')}
      >
        <View style={styles.tutorialText}>
          <Text style={[styles.roomCode, { color: tokens.ink }]}>
            {t('home.play.tutorialTitle')}
          </Text>
          <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>
            {t('home.play.tutorialDesc')}
          </Text>
        </View>
        {tutorialDone && (
          <Text testID="home-tutorial-done" style={[styles.tutorialDone, { color: tokens.ok }]}>
            ✓
          </Text>
        )}
      </Pressable>

      {rooms.length > 0 && (
        <>
          <SectionLabel>{t('home.myRooms')}</SectionLabel>
          <FlatList
            data={rooms}
            keyExtractor={(r) => r.code}
            renderItem={({ item }) => (
              <Pressable
                style={rowStyle}
                onPress={() => navigation.navigate('Room', { code: item.code })}
              >
                <Text style={[styles.roomCode, { color: tokens.ink }]}>{item.code}</Text>
                <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>
                  {t('home.playersCount', { n: item.members.length, max: item.maxPlayers })}
                </Text>
              </Pressable>
            )}
          />
        </>
      )}

      {/* Public rooms: join a lobby, or watch a game already underway (spectate). */}
      {online && (
        <>
          <SectionLabel>{t('home.publicRooms')}</SectionLabel>
          {publicRooms.length === 0 ? (
            <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>
              {t('home.noPublicRooms')}
            </Text>
          ) : (
            publicRooms.map((r) => (
              <View
                key={r.code}
                style={[
                  styles.roomRow,
                  { backgroundColor: tokens.surface, borderColor: tokens.line },
                ]}
              >
                <View style={styles.publicInfo}>
                  <Text style={[styles.roomCode, { color: tokens.ink }]}>{r.code}</Text>
                  <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>
                    {t('home.playersCount', { n: r.members.length, max: r.maxPlayers })} ·{' '}
                    {r.status === 'LOBBY' ? t('home.statusLobby') : t('home.statusPlaying')}
                  </Text>
                </View>
                {r.status === 'LOBBY' ? (
                  <SecondaryButton
                    title={t('home.join')}
                    onPress={() => navigation.navigate('Room', { code: r.code })}
                  />
                ) : (
                  <SecondaryButton
                    title={t('home.watch')}
                    onPress={() =>
                      navigation.navigate('Game', { roomCode: r.code, spectator: true })
                    }
                  />
                )}
              </View>
            ))
          )}
        </>
      )}

      <View style={styles.joinRow}>
        <Field
          style={[styles.joinInput, !online && styles.disabled]}
          placeholder={t('home.joinPlaceholder')}
          autoCapitalize="characters"
          value={code}
          onChangeText={setCode}
          editable={!busy && online}
        />
        <View style={!online && styles.disabled}>
          <SecondaryButton
            title={t('home.join')}
            onPress={() => void joinRoom()}
            disabled={busy || !online}
          />
        </View>
      </View>

      <PrimaryButton
        title={t('home.create')}
        onPress={() => void createRoom()}
        disabled={busy || !online}
      />

      {/* Feature-gated (mapBuilder), hidden entirely without the grant — mirrors web AppHeader. */}
      {canBuild && (
        <SecondaryButton
          testID="home-builder"
          title={t('builder.entry')}
          onPress={() => navigation.navigate('Builder')}
          disabled={!online}
        />
      )}

      <Pressable
        testID="home-settings"
        accessibilityRole="button"
        onPress={() => navigation.navigate('Settings')}
      >
        <Text style={[styles.settingsLink, { color: tokens.blue }]}>{t('settings.title')}</Text>
      </Pressable>

      <Pressable onPress={() => void signOut()}>
        <Text style={[styles.signOut, { color: tokens.danger }]}>{t('home.signOut')}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: SPACE[4], gap: SPACE[3] },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  greeting: { fontSize: 18, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  roomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    marginBottom: SPACE[2],
  },
  roomCode: { fontSize: 16, fontWeight: '700' },
  roomMeta: { fontSize: 14 },
  joinRow: { flexDirection: 'row', gap: SPACE[2], alignItems: 'stretch' },
  joinInput: { flex: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  settingsLink: { textAlign: 'center', marginTop: SPACE[2], fontWeight: '500' },
  signOut: { textAlign: 'center', marginTop: SPACE[1] },
  tutorialText: { gap: 2, flexShrink: 1 },
  tutorialDone: { fontSize: 18, fontWeight: '700' },
  publicInfo: { gap: 2, flexShrink: 1 },
});
