// Live-game shell (ports the web GameScreen): owns the socket lifecycle (useGameConnection), the
// room/roster fetch, and the game-over rematch poll, then delegates the board + HUD to the
// presentational GameStage (shared with the offline/tutorial sandbox in P3/P4).
import { useEffect, useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Phase } from '@trm/proto';
import type { RootStackParamList } from '../navigation';
import { api, type RoomView } from '../net/rest';
import { getSocket } from '../net/connection';
import { useGameConnection } from '../net/useGameConnection';
import { useGame } from '../store/game';
import { useRoster } from '../store/roster';
import { useSession } from '../store/session';
import { useActiveContent } from '../game/useActiveContent';
import { resolveContent } from '../game/contentCache';
import { useTheme } from '../theme/useTheme';
import { GameStage } from './GameStage';
import { FeatureIntroOverlay } from '../features/tutorial/FeatureIntroOverlay';
import { OfflineBanner } from '../components/OfflineBanner';
import { setActiveGameId } from '../push/notifications';
import { setActiveRoomContext } from '../game/activeRoom';
import PushPrompt from '../push/PushPrompt';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

export function GameScreen({ route, navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const roomCode = route.params.roomCode;
  const { sessionReplaced } = useGameConnection(roomCode, {
    spectator: route.params.spectator,
  });
  const snapshot = useGame((s) => s.snapshot);
  const setRoster = useRoster((s) => s.setMembers);
  const user = useSession((s) => s.user);
  const contentStatus = useActiveContent(snapshot?.contentHash);
  // The resolved map content for the one-shot feature-intro check. Once the status is 'ready' the
  // hash resolves synchronously from the content cache (the Promise guard is just belt-and-braces).
  const contentHash = snapshot?.contentHash;
  const activeContent = useMemo(() => {
    if (!contentHash || contentStatus !== 'ready') return null;
    const c = resolveContent(contentHash);
    return c instanceof Promise ? null : c;
  }, [contentHash, contentStatus]);
  const [room, setRoom] = useState<RoomView | null>(null);

  // Pull the room (member + spectator names / bot labels for the trackers, scoreboard and chat,
  // host id and rematch votes for the post-game flow). Snapshots carry ids only — names are
  // lobby data.
  useEffect(() => {
    let cancelled = false;
    api
      .getRoom(roomCode)
      .then((r) => {
        if (!cancelled) {
          setRoster(r.members, r.spectators);
          setRoom(r);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [roomCode, setRoster]);

  // While this game is on screen, its foreground push banners are suppressed (the snapshot has
  // no game id — the room view carries it). The same identity feeds abuse-report context.
  const activeGameId = room?.gameId ?? null;
  useEffect(() => {
    setActiveGameId(activeGameId);
    setActiveRoomContext({ ...(activeGameId ? { gameId: activeGameId } : {}), roomCode });
    return () => {
      setActiveGameId(null);
      setActiveRoomContext({});
    };
  }, [activeGameId, roomCode]);

  // Poll the room every 2s throughout live play: this keeps the roster in sync with spectators
  // who join mid-game (so chat can name them) as well as the rematch vote tally once the game
  // ends, and the moment the host resets a finished game to LOBBY, carries this client back into
  // the room — the same way starting a game carried everyone out of it. Spectators are excluded:
  // they were never room members, and the room screen's own poll would otherwise auto-join a
  // non-member landing on a LOBBY room.
  const phase = snapshot?.phase;
  const gameOver = phase === Phase.GAME_OVER;
  const isSpectator = !snapshot?.you;
  useEffect(() => {
    if (!roomCode || isSpectator) return;
    let active = true;
    const poll = async (): Promise<void> => {
      try {
        const r = await api.getRoom(roomCode);
        if (!active) return;
        if (gameOver && r.status === 'LOBBY') {
          active = false;
          navigation.replace('Room', { code: roomCode });
          return;
        }
        setRoster(r.members, r.spectators);
        setRoom(r);
      } catch {
        // transient — next tick retries; this is a convenience poll, not a critical path
      }
    };
    if (gameOver) void poll();
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
  }, [roomCode, gameOver, isSpectator, navigation, setRoster]);

  // Leaving tears down the socket (unmount → useGameConnection cleanup) AND tells the lobby, so a
  // room whose game already ended (and wasn't rematched) gets freed/closed instead of lingering
  // stuck STARTED forever (see RoomRepo.leave — a no-op unless the linked game is over). Nothing
  // is at stake before the first snapshot arrives, so only confirm once there's an actual game to
  // abandon.
  const leaveRoom = (): void => {
    void api.leaveRoom(roomCode).catch(() => undefined);
    navigation.popToTop();
  };
  const leave = (): void => {
    if (!snapshot) {
      leaveRoom();
      return;
    }
    Alert.alert(t('leaveConfirmTitle'), t('leaveConfirmBody'), [
      { text: t('abort'), style: 'cancel' },
      { text: t('confirm'), style: 'destructive', onPress: leaveRoom },
    ]);
  };

  const voteRematch = async (wantsRematch: boolean): Promise<void> => {
    try {
      const r = await api.voteRematch(roomCode, wantsRematch);
      setRoster(r.members, r.spectators);
      setRoom(r);
    } catch {
      // transient — the next poll tick resyncs
    }
  };

  const playAgain = async (): Promise<void> => {
    try {
      await api.rematch(roomCode);
      navigation.replace('Room', { code: roomCode });
    } catch {
      // e.g. a race with another rematch call — the button stays put for a retry
    }
  };

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
        <Text style={[styles.veilText, { color: tokens.inkSoft }]}>{t('game.connecting')}</Text>
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
        <Text style={[styles.veilText, { color: tokens.inkSoft }]}>{t('game.unknownMap')}</Text>
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
      <GameStage
        snapshot={snapshot}
        commands={getSocket()}
        onLeave={leave}
        isHost={room?.hostId === user?.id}
        rematchMembers={room?.members}
        onVoteRematch={(wants) => void voteRematch(wants)}
        onPlayAgain={() => void playAgain()}
      />
      <OfflineBanner />
      {/* Contextual push ask after the player's FIRST finished game (one-shot; online games only). */}
      {phase === Phase.GAME_OVER && !isSpectator && (
        <View style={styles.promptDock} pointerEvents="box-none">
          <PushPrompt />
        </View>
      )}
      {/* One-shot intro for map mechanics the default map doesn't have (e.g. broken rails). */}
      {activeContent && <FeatureIntroOverlay content={activeContent} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  promptDock: { position: 'absolute', left: 12, right: 12, bottom: 12 },
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
});
