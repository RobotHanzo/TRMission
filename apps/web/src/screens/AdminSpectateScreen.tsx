// The ticket-authorized live-spectate viewer for maintainers (/admin-spectate/:gameId?ticket=...).
// Never auth-gated — the ticket minted by the dashboard is the sole authority. Connects the same
// WebSocket path a real spectator uses (connectGame/GameStage); only the ticket's origin (a
// dashboard mint that bypasses the room's allowSpectating setting) differs.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../store/ui';
import { useGame } from '../store/game';
import { useRoster } from '../store/roster';
import { api } from '../net/rest';
import { connectGame, disconnectGame, getSocket } from '../net/connection';
import { useActiveContent } from '../game/useActiveContent';
import { GameStage } from './GameStage';

type LoadState = { kind: 'loading' } | { kind: 'error'; msgKey: string } | { kind: 'ready' };

export default function AdminSpectateScreen() {
  const { t } = useTranslation();
  const gameId = useUi((s) => s.adminSpectateGameId);
  const ticket = useUi((s) => s.adminSpectateTicket);
  const setMembers = useRoster((s) => s.setMembers);
  const clearRoster = useRoster((s) => s.clear);
  const snapshot = useGame((s) => s.snapshot);
  const contentStatus = useActiveContent(snapshot?.contentHash);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [left, setLeft] = useState(false);

  useEffect(() => {
    if (!gameId || !ticket) {
      setLoad({ kind: 'error', msgKey: 'history.loadFailed' });
      return;
    }
    let cancelled = false;
    setLoad({ kind: 'loading' });
    api
      .adminSpectate(gameId, ticket)
      .then((payload) => {
        if (cancelled) return;
        setMembers(
          payload.players.map((p) => ({
            userId: p.userId,
            displayName: p.displayName ?? '',
            isGuest: false,
            seat: p.seat,
            ready: true,
            ...(p.isBot ? { isBot: true } : {}),
            ...(p.difficulty ? { difficulty: p.difficulty } : {}),
          })),
        );
        connectGame(ticket);
        setLoad({ kind: 'ready' });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error', msgKey: 'history.loadFailed' });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, ticket, setMembers]);

  useEffect(
    () => () => {
      disconnectGame();
      clearRoster();
    },
    [clearRoster],
  );

  const leave = () => {
    disconnectGame();
    setLeft(true);
  };

  if (left) return <div className="card">{t('history.spectateEndedNotice')}</div>;
  if (load.kind === 'loading') return <div className="card">{t('connecting')}</div>;
  if (load.kind === 'error') {
    return (
      <div className="card replay-error">
        <p>{t(load.msgKey)}</p>
      </div>
    );
  }
  if (!snapshot || contentStatus === 'loading') {
    return <div className="card">{t('connecting')}</div>;
  }
  if (contentStatus === 'error') {
    return <div className="card">{t('history.unknownMap')}</div>;
  }

  return <GameStage snapshot={snapshot} commands={getSocket()} onLeave={leave} />;
}
