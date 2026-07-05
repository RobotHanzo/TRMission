// The ticket-authorized replay viewer for maintainers (/admin-replay/:gameId?ticket=...).
// Never auth-gated — the ticket minted by the dashboard is the sole authority. Reuses the
// same ReplayStage/GameStage/useReplayPlayer machinery as the player-facing /replay route.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildBoard, ENGINE_VERSION, SCHEMA_VERSION } from '@trm/engine';
import type { Action, Board, GameConfig } from '@trm/engine';
import { asPlayerId, type RuleParams, type SeatIndex } from '@trm/shared';
import { api, ApiError, type AdminReplayPayload } from '../net/rest';
import { resolveContent } from '../game/contentCache';
import { setActiveContent, resetToDefaultContent } from '../game/catalog';
import { useUi } from '../store/ui';
import { useRoster } from '../store/roster';
import { SandboxProvider } from '../store/sandboxProvider';
import { ReplayStage } from './ReplayScreen';
import '../styles/replay.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; msgKey: string }
  | {
      kind: 'ready';
      payload: AdminReplayPayload;
      board: Board;
      config: GameConfig;
      actions: Action[];
    };

export default function AdminReplayScreen() {
  const { t } = useTranslation();
  const gameId = useUi((s) => s.adminReplayGameId);
  const ticket = useUi((s) => s.adminReplayTicket);
  const setMembers = useRoster((s) => s.setMembers);
  const clearRoster = useRoster((s) => s.clear);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!gameId || !ticket) {
      setLoad({ kind: 'error', msgKey: 'history.loadFailed' });
      return;
    }
    let cancelled = false;
    setLoad({ kind: 'loading' });
    api
      .adminReplay(gameId, ticket)
      .then(async (payload) => {
        if (cancelled) return;
        if (payload.engineVersion !== ENGINE_VERSION || payload.schemaVersion !== SCHEMA_VERSION) {
          setLoad({ kind: 'error', msgKey: 'history.notReplayable' });
          return;
        }
        let board: Board;
        try {
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
            msgKey:
              e instanceof ApiError && e.status === 404
                ? 'history.notReplayable'
                : 'history.loadFailed',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, ticket]);

  useEffect(() => () => resetToDefaultContent(), []);

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

  if (load.kind === 'loading') return <div className="card">{t('connecting')}</div>;
  if (load.kind === 'error') {
    return (
      <div className="card replay-error">
        <p>{t(load.msgKey)}</p>
      </div>
    );
  }

  return (
    <SandboxProvider>
      <AdminReplayStage
        board={load.board}
        config={load.config}
        actions={load.actions}
        players={load.payload.players}
        finalDigest={load.payload.finalDigest}
        status={load.payload.status}
      />
    </SandboxProvider>
  );
}

function AdminReplayStage({
  board,
  config,
  actions,
  players,
  finalDigest,
  status,
}: {
  board: Board;
  config: GameConfig;
  actions: Action[];
  players: AdminReplayPayload['players'];
  finalDigest: string | undefined;
  status: 'COMPLETED' | 'TERMINATED';
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="replay-admin-notice">
        {status === 'TERMINATED'
          ? t('history.terminatedReplayNotice')
          : t('history.completedReplayNotice')}
      </p>
      <ReplayStage
        board={board}
        config={config}
        actions={actions}
        players={players}
        finalDigest={finalDigest}
        initialViewer={null}
      />
    </>
  );
}
