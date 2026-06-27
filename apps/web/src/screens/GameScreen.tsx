import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phase, type GameSnapshot } from '@trm/proto';
import type { RouteDef } from '@trm/map-data';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { connectGame, getSocket, disconnectGame } from '../net/connection';
import { routeById } from '../game/content';
import { isMyTurn } from '../game/view';
import {
  handFromCounts,
  enumerateRoutePayments,
  enumerateStationPayments,
  paymentToProto,
  type Payment,
} from '../game/payments';
import { enumerateTunnelExtra } from '../game/tunnel';
import { Board } from '../components/Board';
import { CardMarket } from '../components/CardMarket';
import { PlayerHand } from '../components/PlayerHand';
import { PlayerTrackers } from '../components/PlayerTrackers';
import { TicketPanel } from '../components/TicketPanel';
import { PaymentModal } from '../components/PaymentModal';
import { KeepTicketsModal } from '../components/KeepTicketsModal';
import { TunnelModal } from '../components/TunnelModal';
import { ScoreBoard } from '../components/ScoreBoard';
import '../styles/game.css';

type Claim =
  | { kind: 'route'; route: RouteDef; payments: Payment[] }
  | { kind: 'station'; cityId: string; payments: Payment[] };

const otherLabel = (snap: GameSnapshot): string => {
  const p = snap.players.find((pl) => pl.id === snap.currentPlayerId);
  return p ? `P${p.seat + 1}` : '';
};

export function GameScreen() {
  const { t } = useTranslation();
  const ticket = useUi((s) => s.ticket);
  const locale = useUi((s) => s.locale);
  const colorBlind = useUi((s) => s.colorBlind);
  const goHome = useUi((s) => s.goHome);

  const snapshot = useGame((s) => s.snapshot);
  const status = useGame((s) => s.status);
  const rejection = useGame((s) => s.rejection);
  const setRejection = useGame((s) => s.setRejection);

  const [claim, setClaim] = useState<Claim | null>(null);
  const [tunnelColor, setTunnelColor] = useState<Payment['color']>(null);

  const version = snapshot?.stateVersion ?? 0;

  useEffect(() => {
    if (ticket && !getSocket()) connectGame(ticket);
  }, [ticket]);
  useEffect(() => {
    setRejection(null);
  }, [version, setRejection]);
  useEffect(() => {
    if (!rejection) return;
    const id = setTimeout(() => setRejection(null), 3000);
    return () => clearTimeout(id);
  }, [rejection, setRejection]);

  const leave = () => {
    disconnectGame();
    goHome();
  };

  if (!snapshot) {
    return (
      <div className="card">
        {t('connecting')} · <button onClick={leave}>{t('back')}</button>
      </div>
    );
  }

  const socket = getSocket();
  const me = snapshot.you?.playerId ?? null;
  const myPub = snapshot.players.find((p) => p.id === me);
  const hand = handFromCounts(snapshot.you?.hand);
  const phase = snapshot.phase;
  const myTurn = isMyTurn(snapshot);
  const canAct = myTurn && phase === Phase.AWAIT_ACTION;
  const canDraw = myTurn && (phase === Phase.AWAIT_ACTION || phase === Phase.DRAWING_CARDS);

  const pickRoute = (routeId: string) => {
    const route = routeById.get(routeId);
    if (!route) return;
    const payments = enumerateRoutePayments(hand, route);
    if (payments.length) setClaim({ kind: 'route', route, payments });
  };
  const pickCity = (cityId: string) => {
    const remaining = myPub?.stationsRemaining ?? 0;
    if (remaining <= 0) return;
    const payments = enumerateStationPayments(hand, 3 - remaining + 1);
    if (payments.length) setClaim({ kind: 'station', cityId, payments });
  };
  const confirmPayment = (p: Payment) => {
    if (!socket || !claim) return;
    if (claim.kind === 'route') {
      if (claim.route.isTunnel) setTunnelColor(p.color);
      socket.claimRoute(claim.route.id as string, paymentToProto(p));
    } else {
      socket.buildStation(claim.cityId, paymentToProto(p));
    }
    setClaim(null);
  };

  const needKeep =
    (phase === Phase.SETUP_TICKETS || phase === Phase.TICKET_SELECTION) &&
    (snapshot.you?.pendingOfferTicketIds.length ?? 0) > 0;
  const confirmKeep = (ids: string[]) => {
    if (!socket) return;
    if (phase === Phase.SETUP_TICKETS) socket.keepInitialTickets(ids);
    else socket.keepTickets(ids);
  };

  const tunnelMine = phase === Phase.TUNNEL_PENDING && snapshot.pendingTunnel?.playerId === me;
  const tunnelExtras =
    tunnelMine && snapshot.pendingTunnel
      ? enumerateTunnelExtra(hand, tunnelColor, snapshot.pendingTunnel.extraRequired)
      : [];

  const turnLabel =
    phase === Phase.GAME_OVER
      ? t('gameOver')
      : myTurn
        ? t('yourTurn')
        : t('turnOf', { name: otherLabel(snapshot) });

  return (
    <div className="game">
      <header className="game-header">
        <span className={`conn conn-${status}`}>
          {status === 'open'
            ? t('connected')
            : status === 'closed'
              ? t('disconnected')
              : t('reconnecting')}
        </span>
        <strong>{turnLabel}</strong>
        <button onClick={leave}>{t('leave')}</button>
      </header>

      <div className="game-body">
        <div className="board-wrap">
          <Board
            snapshot={snapshot}
            locale={locale}
            colorBlind={colorBlind}
            canAct={canAct}
            onPickRoute={pickRoute}
            onPickCity={pickCity}
          />
        </div>
        <aside className="hud">
          <PlayerTrackers snapshot={snapshot} />
          <CardMarket
            snapshot={snapshot}
            canDraw={canDraw}
            onDrawFaceUp={(slot) => socket?.drawFaceUp(slot)}
            onDrawBlind={() => socket?.drawBlind()}
          />
          <div className="row">
            <button disabled={!canAct} onClick={() => socket?.drawTickets()}>
              {t('drawTickets')}
            </button>
            <button disabled={!canAct} onClick={() => socket?.pass()}>
              {t('pass')}
            </button>
          </div>
          <TicketPanel ticketIds={snapshot.you?.keptTicketIds ?? []} />
          <div>
            <h4>{t('cards')}</h4>
            <PlayerHand hand={snapshot.you?.hand} />
          </div>
        </aside>
      </div>

      {claim && (
        <PaymentModal
          title={claim.kind === 'route' ? t('claimRoute') : t('buildStation')}
          options={claim.payments}
          onPick={confirmPayment}
          onCancel={() => setClaim(null)}
        />
      )}
      {needKeep && (
        <KeepTicketsModal
          offered={snapshot.you?.pendingOfferTicketIds ?? []}
          minKeep={phase === Phase.SETUP_TICKETS ? 2 : 1}
          onConfirm={confirmKeep}
        />
      )}
      {tunnelMine && snapshot.pendingTunnel && (
        <TunnelModal
          revealed={snapshot.pendingTunnel.revealed}
          extraRequired={snapshot.pendingTunnel.extraRequired}
          options={tunnelExtras}
          onCommit={(p) => {
            socket?.resolveTunnel(true, paymentToProto(p));
            setTunnelColor(null);
          }}
          onAbort={() => {
            socket?.resolveTunnel(false);
            setTunnelColor(null);
          }}
        />
      )}
      {phase === Phase.GAME_OVER && <ScoreBoard snapshot={snapshot} onLeave={leave} />}
      {rejection && <div className="toast">{t('actionRejected')}</div>}
    </div>
  );
}
