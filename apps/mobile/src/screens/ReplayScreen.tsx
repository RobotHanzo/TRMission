// The replay player for one finished game (ports the web ReplayScreen). Fetches the replay
// payload (config + action log), guards engine/content version skew, then mounts the standard
// GameStage inside ISOLATED sandbox stores driven by the SHARED replay player
// (@trm/client-core/replay). Never touches the live game singletons or the WebSocket.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react-native';
import { buildBoard } from '@trm/engine';
import type { Action, Board, GameConfig } from '@trm/engine';
import { asPlayerId, type RuleParams, type SeatIndex } from '@trm/shared';
import { useReplayPlayer } from '@trm/client-core/replay/useReplayPlayer';
import { frameTargetForAction } from '@trm/client-core/replay/frameTarget';
import { isReplayVersionCompatible } from '@trm/client-core/replay/compatibility';
import type { RootStackParamList } from '../navigation';
import { api, ApiError, type ReplayPayload, type ReplayPlayerMeta } from '../net/rest';
import { resolveContent } from '../game/contentCache';
import { setActiveContent, resetToDefaultContent } from '../game/catalog';
import { useSession } from '../store/session';
import { useRoster } from '../store/roster';
import { SandboxProvider } from '../store/sandboxProvider';
import { useGameStore, useGameStoreApi } from '../store/game';
import { useLogStoreApi } from '../store/log';
import { useUi } from '../store/ui';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { seatColor } from '../theme/colors';
import { useTheme } from '../theme/useTheme';
import { ErrorText, MutedText } from '../theme/chrome';
import { GameStage } from './GameStage';

type Props = NativeStackScreenProps<RootStackParamList, 'Replay'>;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; msgKey: string }
  | { kind: 'ready'; payload: ReplayPayload; board: Board; config: GameConfig; actions: Action[] };

export default function ReplayScreen({ route, navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const { gameId } = route.params;
  const user = useSession((s) => s.user);
  const setMembers = useRoster((s) => s.setMembers);
  const clearRoster = useRoster((s) => s.clear);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    api
      .replay(gameId)
      .then(async (payload) => {
        if (cancelled) return;
        // The client must explicitly support the stored engine + schema — the server's
        // `replayable` flag is advisory; this is the authoritative check.
        if (!isReplayVersionCompatible(payload.engineVersion, payload.schemaVersion)) {
          setLoad({ kind: 'error', msgKey: 'history.notReplayable' });
          return;
        }
        let board: Board;
        try {
          // resolveContent covers both official maps (bundled, synchronous) and custom maps
          // (fetched from /maps/content/:hash) — buildBoard works for either uniformly.
          const content = await resolveContent(payload.config.contentHash);
          if (cancelled) return;
          board = buildBoard(content);
          setActiveContent(content);
        } catch {
          setLoad({ kind: 'error', msgKey: 'history.unknownMap' });
          return;
        }
        const config: GameConfig = {
          seed: payload.config.seed,
          players: payload.config.players.map((p) => ({
            id: asPlayerId(p.id),
            seat: p.seat as SeatIndex,
          })),
          contentHash: payload.config.contentHash,
          ...(payload.config.ruleParams
            ? { ruleParams: payload.config.ruleParams as Partial<RuleParams> }
            : {}),
          ...(payload.config.shuffleTurnOrder !== undefined
            ? { shuffleTurnOrder: payload.config.shuffleTurnOrder }
            : {}),
        };
        setLoad({ kind: 'ready', payload, board, config, actions: payload.actions as Action[] });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setLoad({
            kind: 'error',
            // 403 = the account lacks the replayReview feature.
            msgKey:
              e instanceof ApiError && e.status === 403
                ? 'history.replayDisabled'
                : 'history.loadFailed',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  // Leaving replay must never leave a custom map's catalog active for the next screen.
  useEffect(() => () => resetToDefaultContent(), []);

  // Roster names for trackers/scoreboard/log — same channel a live game fills from the lobby.
  useEffect(() => {
    if (load.kind !== 'ready') return;
    setMembers(
      load.payload.players.map((p) => ({
        userId: p.userId,
        displayName: p.displayName ?? '',
        isGuest: false,
        seat: p.seat,
        ready: true,
        ...(p.isBot ? { isBot: true } : {}),
        ...(p.difficulty ? { difficulty: p.difficulty } : {}),
      })),
    );
    return () => clearRoster();
  }, [load, setMembers, clearRoster]);

  if (load.kind === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: tokens.paper }]}>
        <MutedText center>{t('game.connecting')}</MutedText>
      </View>
    );
  }
  if (load.kind === 'error') {
    return (
      <View style={[styles.center, { backgroundColor: tokens.paper }]}>
        <ErrorText>{t(load.msgKey)}</ErrorText>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()}>
          <Text style={[styles.backLink, { color: tokens.blue }]}>
            {t('history.backToHistory')}
          </Text>
        </Pressable>
      </View>
    );
  }

  const initialViewer =
    user && load.payload.players.some((p) => p.userId === user.id) ? asPlayerId(user.id) : null;

  return (
    <SandboxProvider>
      <ReplayStage
        board={load.board}
        config={load.config}
        actions={load.actions}
        players={load.payload.players}
        finalDigest={load.payload.finalDigest}
        initialViewer={initialViewer}
        onLeave={() => navigation.goBack()}
      />
    </SandboxProvider>
  );
}

function ReplayStage({
  board,
  config,
  actions,
  players,
  finalDigest,
  initialViewer,
  onLeave,
}: {
  board: Board;
  config: GameConfig;
  actions: Action[];
  players: ReplayPlayerMeta[];
  finalDigest: string | undefined;
  initialViewer: ReturnType<typeof asPlayerId> | null;
  onLeave(): void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const gameStore = useGameStoreApi();
  const logStore = useLogStoreApi();
  const reducedMotion = useReducedMotion();
  const stores = useMemo(() => ({ game: gameStore, log: logStore }), [gameStore, logStore]);
  const player = useReplayPlayer(board, config, actions, initialViewer, stores, {
    finalDigest,
    reducedMotion,
  });
  const snapshot = useGameStore((s) => s.snapshot);
  const followActing = useUi((s) => s.followActing);
  const setFollowActing = useUi((s) => s.setFollowActing);
  const [trackWidth, setTrackWidth] = useState(0);

  // Replay is meant to be watched — default auto-follow on (the board's eye toggle still works).
  useEffect(() => {
    void setFollowActing(true);
  }, [setFollowActing]);

  const currentAction = player.step > 0 ? (actions[player.step - 1] ?? null) : null;
  const frameTarget = followActing ? frameTargetForAction(currentAction, !player.animate) : null;

  if (player.error) {
    return (
      <View style={[styles.center, { backgroundColor: tokens.paper }]}>
        <ErrorText>{t('history.notReplayable')}</ErrorText>
        <Pressable accessibilityRole="button" onPress={onLeave}>
          <Text style={[styles.backLink, { color: tokens.blue }]}>
            {t('history.backToHistory')}
          </Text>
        </Pressable>
      </View>
    );
  }
  if (!snapshot) {
    return (
      <View style={[styles.center, { backgroundColor: tokens.paper }]}>
        <MutedText center>{t('game.connecting')}</MutedText>
      </View>
    );
  }

  const seatOf = new Map(players.map((p) => [p.userId, p.seat]));

  return (
    <View style={styles.fill}>
      <View style={styles.stage}>
        <GameStage
          snapshot={snapshot}
          commands={null}
          sandbox
          frameTarget={frameTarget}
          onLeave={onLeave}
        />
      </View>

      {/* ── perspective: whose secrets to project (or the public view) ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.perspectiveBar, { borderColor: tokens.line }]}
        contentContainerStyle={styles.perspectiveRow}
      >
        <PerspectiveChip
          label={t('history.publicView')}
          selected={player.viewer === null}
          color={tokens.inkSoft}
          onPress={() => player.setViewer(null)}
        />
        {players.map((p) => (
          <PerspectiveChip
            key={p.userId}
            label={p.displayName || `P${p.seat + 1}`}
            selected={player.viewer === p.userId}
            color={seatColor(seatOf.get(p.userId) ?? 0)}
            onPress={() => player.setViewer(asPlayerId(p.userId))}
          />
        ))}
      </ScrollView>

      {/* ── transport: prev / play-pause / next + a tap-to-seek progress track ── */}
      <View
        style={[styles.controls, { backgroundColor: tokens.surface, borderColor: tokens.line }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tutorial.prevStep')}
          disabled={player.step <= 0}
          style={[styles.ctlBtn, player.step <= 0 && styles.disabled]}
          onPress={player.prev}
        >
          <SkipBack size={18} color={tokens.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={player.playing ? t('tutorial.pause') : t('tutorial.play')}
          disabled={player.atEnd}
          style={[styles.ctlBtn, player.atEnd && styles.disabled]}
          onPress={player.playing ? player.pause : player.play}
          testID="replay-playpause"
        >
          {player.playing ? (
            <Pause size={18} color={tokens.ink} />
          ) : (
            <Play size={18} color={tokens.ink} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('tutorial.nextStep')}
          disabled={player.atEnd}
          style={[styles.ctlBtn, player.atEnd && styles.disabled]}
          onPress={player.next}
          testID="replay-next"
        >
          <SkipForward size={18} color={tokens.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={t('history.step', { n: player.step, total: player.total })}
          style={styles.track}
          onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            if (trackWidth <= 0 || player.total === 0) return;
            const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / trackWidth));
            player.seek(Math.round(ratio * player.total));
          }}
        >
          <View style={[styles.trackBed, { backgroundColor: tokens.line }]} />
          <View
            style={[
              styles.trackFill,
              {
                backgroundColor: tokens.blue,
                width: `${player.total > 0 ? (player.step / player.total) * 100 : 0}%`,
              },
            ]}
          />
        </Pressable>
        <Text style={[styles.stepText, { color: tokens.inkSoft }]}>
          {t('history.step', { n: player.step, total: player.total })}
        </Text>
      </View>
    </View>
  );
}

function PerspectiveChip({
  label,
  selected,
  color,
  onPress,
}: {
  label: string;
  selected: boolean;
  color: string;
  onPress(): void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? color : tokens.line },
        selected && { backgroundColor: `${color}22` },
      ]}
    >
      <View style={[styles.chipDot, { backgroundColor: color }]} />
      <Text style={[styles.chipText, { color: selected ? color : tokens.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stage: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  backLink: { fontSize: 15, fontWeight: '600', padding: 8 },
  perspectiveBar: { flexGrow: 0, borderTopWidth: 1 },
  perspectiveRow: { flexDirection: 'row', gap: 6, padding: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 36,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 13, fontWeight: '600' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ctlBtn: {
    padding: 10,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  track: { flex: 1, height: 44, justifyContent: 'center' },
  trackBed: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  trackFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  stepText: { fontSize: 11, fontVariant: ['tabular-nums'] },
});
