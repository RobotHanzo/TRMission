// Live-game shell (ports the web GameScreen): owns the socket lifecycle (useGameConnection), the
// roster fetch, and the game-over rematch poll, then delegates rendering to the board. Until the
// GameStage (Task 9) lands, the board fills the screen behind a minimal room-code strip so the
// connect/resync/offline machinery is independently verifiable on device.
import { useEffect } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Phase } from '@trm/proto';
import type { RootStackParamList } from '../navigation';
import { api } from '../net/rest';
import { useGameConnection } from '../net/useGameConnection';
import { useGame } from '../store/game';
import { useRoster } from '../store/roster';
import { useUi } from '../store/ui';
import { useActiveContent } from '../game/useActiveContent';
import { BoardView } from '../board/BoardView';
import { OfflineBanner } from '../components/OfflineBanner';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

const noop = (): void => {};

export function GameScreen({ route, navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const roomCode = route.params.roomCode;
  const { sessionReplaced } = useGameConnection(roomCode);
  const snapshot = useGame((s) => s.snapshot);
  const setRoster = useRoster((s) => s.setMembers);
  const locale = useUi((s) => s.locale);
  const colorBlind = useUi((s) => s.colorBlind);
  const contentStatus = useActiveContent(snapshot?.contentHash);

  // Pull the room's members (real account names / bot labels) so the trackers, scoreboard and
  // turn banner can show them instead of "P{seat+1}". Snapshots carry ids only — names are
  // lobby data. (The full RoomView — host/rematch tally — wires into GameStage in Task 9.)
  useEffect(() => {
    let cancelled = false;
    api
      .getRoom(roomCode)
      .then((r) => {
        if (!cancelled) setRoster(r.members);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [roomCode, setRoster]);

  // Once the game is over, poll the room every 2s: the moment the host resets it to LOBBY, carry
  // this client back into the room — the same way starting a game carried everyone out of it.
  // Spectators are excluded: they were never room members, and the room screen's own poll would
  // otherwise auto-join a non-member landing on a LOBBY room.
  const phase = snapshot?.phase;
  const isSpectator = !snapshot?.you;
  useEffect(() => {
    if (phase !== Phase.GAME_OVER || isSpectator) return;
    let active = true;
    const poll = async (): Promise<void> => {
      try {
        const r = await api.getRoom(roomCode);
        if (!active) return;
        if (r.status === 'LOBBY') {
          active = false;
          navigation.replace('Room', { code: roomCode });
          return;
        }
        setRoster(r.members);
      } catch {
        // transient — next tick retries; this is a convenience poll, not a critical path
      }
    };
    void poll();
    const id = setInterval(() => {
      if (!active) {
        clearInterval(id);
        return;
      }
      void poll();
    }, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [roomCode, phase, isSpectator, navigation, setRoster]);

  // Another connection took over this seat — the socket is closed and will not reconnect. This
  // takes priority over every state below; none of them are recoverable once the seat is gone.
  if (sessionReplaced) {
    return (
      <View style={styles.veil}>
        <View style={styles.dialog} accessibilityRole="alert">
          <Text style={styles.dialogTitle}>{t('game.sessionReplacedTitle')}</Text>
          <Text style={styles.dialogBody}>{t('game.sessionReplacedBody')}</Text>
          <Pressable
            style={styles.primaryBtn}
            accessibilityRole="button"
            onPress={() => navigation.popToTop()}
          >
            <Text style={styles.primaryText}>{t('game.sessionReplacedAck')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!snapshot || contentStatus === 'loading') {
    return (
      <View style={styles.veil}>
        <Text style={styles.veilText}>{t('game.connecting')}</Text>
        <Pressable
          style={styles.linkBtn}
          accessibilityRole="button"
          onPress={() => navigation.popToTop()}
        >
          <Text style={styles.linkText}>{t('game.back')}</Text>
        </Pressable>
      </View>
    );
  }
  if (contentStatus === 'error') {
    return (
      <View style={styles.veil}>
        <Text style={styles.veilText}>{t('game.unknownMap')}</Text>
        <Pressable
          style={styles.linkBtn}
          accessibilityRole="button"
          onPress={() => navigation.popToTop()}
        >
          <Text style={styles.linkText}>{t('game.back')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <BoardView
        snapshot={snapshot}
        locale={locale}
        colorBlind={colorBlind}
        canAct={false}
        onPickRoute={noop}
        onPickCity={noop}
      />
      {/* Placeholder strip — GameStage (Task 9) replaces it with the real HUD. */}
      <View style={styles.roomStrip} pointerEvents="none">
        <Text style={styles.roomStripText}>{t('game.roomLabel', { code: roomCode })}</Text>
      </View>
      <OfflineBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  veil: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  veilText: { fontSize: 15, opacity: 0.75 },
  linkBtn: { padding: 8 },
  linkText: { fontSize: 15, fontWeight: '600', color: '#1d4ed8' },
  dialog: {
    maxWidth: 420,
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 20,
    gap: 10,
    elevation: 4,
  },
  dialogTitle: { fontSize: 17, fontWeight: '700' },
  dialogBody: { fontSize: 14, opacity: 0.8, lineHeight: 20 },
  primaryBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryText: { color: '#fff', fontWeight: '600' },
  roomStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 4,
    backgroundColor: 'rgba(255,253,248,0.75)',
  },
  roomStripText: { fontSize: 12, opacity: 0.7 },
});
