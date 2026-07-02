// The replay player for one finished game (/replay/:gameId). Fetches the replay payload
// (config + action log), guards engine/content version skew, then mounts the standard
// GameStage inside ISOLATED sandbox stores driven by useReplayPlayer. Never touches the
// live game singletons or the WebSocket.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { boardForContentHash, ENGINE_VERSION, SCHEMA_VERSION } from '@trm/engine';
import type { Action, Board, GameConfig } from '@trm/engine';
import { asPlayerId, type RuleParams, type SeatIndex } from '@trm/shared';
import { api, type ReplayPayload, type ReplayPlayerMeta } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useRoster } from '../store/roster';
import { SandboxProvider } from '../store/sandboxProvider';
import { useGameStore, useGameStoreApi } from '../store/game';
import { useLogStoreApi } from '../store/log';
import { GameStage } from './GameStage';
import { LogPanel } from '../components/LogPanel';
import { useReplayPlayer } from '../features/replay/useReplayPlayer';
import { PerspectiveSwitcher } from '../features/replay/PerspectiveSwitcher';
import { frameTargetForAction } from '../features/replay/frameTarget';
import '../styles/replay.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; msgKey: string }
  | { kind: 'ready'; payload: ReplayPayload; board: Board; config: GameConfig; actions: Action[] };

export default function ReplayScreen() {
  const { t } = useTranslation();
  const gameId = useUi((s) => s.replayGameId);
  const enterHistory = useUi((s) => s.enterHistory);
  const user = useSession((s) => s.user);
  const setMembers = useRoster((s) => s.setMembers);
  const clearRoster = useRoster((s) => s.clear);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setLoad({ kind: 'loading' });
    api
      .replay(gameId)
      .then((payload) => {
        if (cancelled) return;
        // The client's OWN engine must match the stored game — the server's `replayable`
        // flag is advisory; this is the authoritative check.
        if (payload.engineVersion !== ENGINE_VERSION || payload.schemaVersion !== SCHEMA_VERSION) {
          setLoad({ kind: 'error', msgKey: 'history.notReplayable' });
          return;
        }
        let board: Board;
        try {
          board = boardForContentHash(payload.config.contentHash);
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
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error', msgKey: 'history.loadFailed' });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

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

  if (!gameId) return null;
  if (load.kind === 'loading') return <div className="card">{t('connecting')}</div>;
  if (load.kind === 'error') {
    return (
      <div className="card replay-error">
        <p>{t(load.msgKey)}</p>
        <button onClick={enterHistory}>{t('history.backToHistory')}</button>
      </div>
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
        onLeave={enterHistory}
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
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const gameStore = useGameStoreApi();
  const logStore = useLogStoreApi();
  const stores = useMemo(() => ({ game: gameStore, log: logStore }), [gameStore, logStore]);
  const player = useReplayPlayer(board, config, actions, initialViewer, stores, finalDigest);
  const snapshot = useGameStore((s) => s.snapshot);
  const followActing = useUi((s) => s.followActing);
  const setFollowActing = useUi((s) => s.setFollowActing);

  // Replay is meant to be watched — default auto-follow on regardless of whatever live play left
  // the shared toggle at. The eye icon (rendered by MapControls, sandbox or not) still turns it off.
  useEffect(() => {
    setFollowActing(true);
  }, [setFollowActing]);

  const currentAction = player.step > 0 ? (actions[player.step - 1] ?? null) : null;
  const frameTarget = followActing ? frameTargetForAction(currentAction, !player.animate) : null;

  if (player.error) {
    return (
      <div className="card replay-error">
        <p>{t('history.notReplayable')}</p>
        <button onClick={onLeave}>{t('history.backToHistory')}</button>
      </div>
    );
  }
  if (!snapshot) return <div className="card">{t('connecting')}</div>;

  return (
    <div className="replay">
      <div className="replay-stage">
        <GameStage
          snapshot={snapshot}
          commands={null}
          sandbox
          frameTarget={frameTarget}
          onLeave={onLeave}
        />
      </div>
      <aside className="replay-rail">
        <PerspectiveSwitcher players={players} viewer={player.viewer} onChange={player.setViewer} />
        <LogPanel />
      </aside>
      <div className="replay-controls">
        <button
          className="icon-btn"
          onClick={player.prev}
          disabled={player.step <= 0}
          aria-label={t('tutorial.prevStep')}
          title={t('tutorial.prevStep')}
        >
          <SkipBack size={16} aria-hidden />
        </button>
        <button
          className="icon-btn"
          onClick={player.playing ? player.pause : player.play}
          disabled={player.atEnd}
          aria-label={player.playing ? t('tutorial.pause') : t('tutorial.play')}
          title={player.playing ? t('tutorial.pause') : t('tutorial.play')}
        >
          {player.playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <button
          className="icon-btn"
          onClick={player.next}
          disabled={player.atEnd}
          aria-label={t('tutorial.nextStep')}
          title={t('tutorial.nextStep')}
        >
          <SkipForward size={16} aria-hidden />
        </button>
        <input
          type="range"
          className="replay-scrubber"
          min={0}
          max={player.total}
          value={player.step}
          onChange={(e) => player.seek(Number(e.target.value))}
          aria-label={t('history.step', { n: player.step, total: player.total })}
        />
        <span className="replay-step">
          {t('history.step', { n: player.step, total: player.total })}
        </span>
      </div>
    </div>
  );
}
