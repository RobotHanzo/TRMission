import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phase } from '@trm/proto';
import type { RouteDef } from '@trm/map-data';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { useRoster } from '../store/roster';
import { api } from '../net/rest';
import { connectGame, getSocket } from '../net/connection';
import { routeById, ticketById } from '../game/content';
import { completedByPlayer } from '../game/tickets';
import { isMyTurn } from '../game/view';
import { isChatRejectionKey } from '../game/chatErrors';
import {
  handFromCounts,
  handAfterPayment,
  enumerateRoutePayments,
  enumerateStationPayments,
  routeShortfall,
  stationShortfall,
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
import { TicketChooser } from '../components/TicketChooser';
import { TunnelModal } from '../components/TunnelModal';
import { ScoreBoard } from '../components/ScoreBoard';
import { AnimationLayer } from '../components/AnimationLayer';
import { Toast } from '../components/Toast';
import { CommsPanel } from '../components/CommsPanel';
import { useAnimationDriver } from '../hooks/useAnimationDriver';
import { useSoundDriver } from '../hooks/useSoundDriver';
import { useMediaQuery } from '../hooks/useMediaQuery';
import '../styles/game.css';
import '../styles/animations.css';

type Claim =
  | { kind: 'route'; route: RouteDef; payments: Payment[] }
  | { kind: 'station'; cityId: string; payments: Payment[] };

export function GameScreen() {
  const { t } = useTranslation();
  const ticket = useUi((s) => s.ticket);
  const roomCode = useUi((s) => s.roomCode);
  const locale = useUi((s) => s.locale);
  const colorBlind = useUi((s) => s.colorBlind);
  const boardLayout = useUi((s) => s.boardLayout);
  const goHome = useUi((s) => s.goHome);

  const wide = useMediaQuery('(min-width: 1300px)');
  const [commsTab, setCommsTab] = useState<'rail' | 'comms'>('rail');

  const snapshot = useGame((s) => s.snapshot);
  const rejection = useGame((s) => s.rejection);
  const setRejection = useGame((s) => s.setRejection);
  const setRoster = useRoster((s) => s.setMembers);

  // Translate events + snapshot diffs into animations (claim glow, draws, fanfare, …).
  useAnimationDriver();
  // Translate the same streams into sound effects.
  useSoundDriver();

  const [claim, setClaim] = useState<Claim | null>(null);
  // The base payment committed to a pending tunnel claim. Its cards stay in hand until the tunnel
  // resolves, so the surcharge must be enumerated against the hand minus this.
  const [tunnelBase, setTunnelBase] = useState<Payment | null>(null);
  // Client-side nudge (e.g. "not enough cards") shown when a click can't open a modal.
  const [notice, setNotice] = useState<string | null>(null);

  const version = snapshot?.stateVersion ?? 0;

  useEffect(() => {
    if (ticket && !getSocket()) connectGame(ticket);
  }, [ticket]);
  // Pull the room's members (real account names / bot labels) so the trackers, scoreboard and
  // turn banner can show them instead of "P{seat+1}". Snapshots carry ids only — names are lobby
  // data. Best-effort: on failure the UI just keeps the P{seat+1} fallback.
  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    api
      .getRoom(roomCode)
      .then((r) => {
        if (!cancelled) setRoster(r.members);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomCode, setRoster]);
  useEffect(() => {
    setRejection(null);
  }, [version, setRejection]);
  useEffect(() => {
    if (!rejection) return;
    const id = setTimeout(() => setRejection(null), 3000);
    return () => clearTimeout(id);
  }, [rejection, setRejection]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  const leave = () => goHome(); // goHome tears down the socket

  if (!snapshot) {
    return (
      <div className="card">
        {t('connecting')} · <button onClick={leave}>{t('back')}</button>
      </div>
    );
  }

  const socket = getSocket();
  const me = snapshot.you?.playerId ?? null;
  // No SelfView ⇒ this connection is a spectator: read-only, no actions can fire (all action
  // affordances below are gated on `me`/`canAct`/`canDraw`, which are falsy here).
  const isSpectator = !snapshot.you;
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
    if (payments.length) {
      setClaim({ kind: 'route', route, payments });
      return;
    }
    const s = routeShortfall(hand, route);
    setNotice(
      s.kind === 'locos'
        ? t('insufficientLocos', { need: s.need, have: s.have })
        : t('insufficientCards', { need: s.need, have: s.have }),
    );
  };
  const pickCity = (cityId: string) => {
    const remaining = myPub?.stationsRemaining ?? 0;
    if (remaining <= 0) {
      setNotice(t('noStationsLeft'));
      return;
    }
    const cost = 3 - remaining + 1;
    const payments = enumerateStationPayments(hand, cost);
    if (payments.length) {
      setClaim({ kind: 'station', cityId, payments });
      return;
    }
    const s = stationShortfall(hand, cost);
    setNotice(t('insufficientCards', { need: s.need, have: s.have }));
  };
  const confirmPayment = (p: Payment) => {
    if (!socket || !claim) return;
    if (claim.kind === 'route') {
      if (claim.route.isTunnel) setTunnelBase(p);
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
  // While choosing tickets the chooser takes over the rail and the board stays interactive, so
  // softly glow the endpoint cities of the offered tickets to help preview the railways they need.
  const ticketEndpoints = needKeep
    ? new Set(
        (snapshot.you?.pendingOfferTicketIds ?? []).flatMap((id) => {
          const def = ticketById.get(id);
          return def ? [def.a as string, def.b as string] : [];
        }),
      )
    : undefined;

  const tunnelMine = phase === Phase.TUNNEL_PENDING && snapshot.pendingTunnel?.playerId === me;
  const tunnelExtras =
    tunnelMine && snapshot.pendingTunnel
      ? enumerateTunnelExtra(
          tunnelBase ? handAfterPayment(hand, tunnelBase) : hand,
          tunnelBase?.color ?? null,
          snapshot.pendingTunnel.extraRequired,
        )
      : [];

  const boardPanel = (
    <div className="game-board">
      <Board
        snapshot={snapshot}
        locale={locale}
        colorBlind={colorBlind}
        canAct={canAct}
        onPickRoute={pickRoute}
        onPickCity={pickCity}
        highlightCities={ticketEndpoints}
      />
    </div>
  );
  const trackers = (
    <div className="hud-block">
      <PlayerTrackers snapshot={snapshot} />
    </div>
  );
  const market = (
    <div className="hud-block">
      <CardMarket
        snapshot={snapshot}
        canDraw={canDraw}
        onDrawFaceUp={(slot) => socket?.drawFaceUp(slot)}
        onDrawBlind={() => socket?.drawBlind()}
      />
      <div className="hud-actions">
        <button
          className="accent"
          disabled={!canAct || snapshot.ticketDeckShortCount === 0}
          onClick={() => socket?.drawTickets()}
        >
          {t('drawTickets')}
          {snapshot.ticketDeckShortCount === 0
            ? ` (${t('deckEmpty')})`
            : ` (${snapshot.ticketDeckShortCount})`}
        </button>
      </div>
    </div>
  );
  const handSection = (
    <section className="tray-section">
      <div className="tray-head">
        <h4>{t('cards')}</h4>
        <span className="tray-count">{myPub?.handCount ?? 0}</span>
      </div>
      <PlayerHand hand={snapshot.you?.hand} />
    </section>
  );
  const ticketsSection = (
    <section className="tray-section tray-missions" data-anim="tickets">
      <div className="tray-head">
        <h4>{t('tickets')}</h4>
        <span className="tray-count">{snapshot.you?.keptTicketIds.length ?? 0}</span>
      </div>
      <TicketPanel
        ticketIds={snapshot.you?.keptTicketIds ?? []}
        completedIds={me ? completedByPlayer(snapshot).get(me) : undefined}
      />
    </section>
  );

  const railInner = needKeep ? (
    <TicketChooser
      offered={snapshot.you?.pendingOfferTicketIds ?? []}
      minKeep={phase === Phase.SETUP_TICKETS ? 2 : 1}
      lockLong={phase === Phase.SETUP_TICKETS}
      hand={snapshot.you?.hand}
      handCount={myPub?.handCount ?? 0}
      keptTicketIds={snapshot.you?.keptTicketIds ?? []}
      completedIds={me ? completedByPlayer(snapshot).get(me) : undefined}
      onConfirm={confirmKeep}
    />
  ) : boardLayout === 'rail' ? (
    <>
      {trackers}
      {market}
      {handSection}
      {ticketsSection}
    </>
  ) : (
    <>
      {trackers}
      {market}
      {ticketsSection}
    </>
  );
  const showHandStrip = !needKeep && boardLayout === 'tray';
  const comms = <CommsPanel chatDisabled={isSpectator} />;

  return (
    <div className={`game game--${boardLayout}`}>
      {isSpectator && (
        <div className="spectator-banner" role="status">
          <strong>{t('spectating')}</strong> — {t('spectatingHint')}
        </div>
      )}
      {boardPanel}
      {wide ? (
        <>
          <aside className="game-rail">{railInner}</aside>
          {showHandStrip && <div className="game-hand-strip">{handSection}</div>}
          <aside className="game-comms">{comms}</aside>
        </>
      ) : (
        <>
          <aside className="game-rail">
            <div className="comms-tabs" role="tablist" aria-label={t('commsTabsLabel')}>
              <button
                type="button"
                role="tab"
                id="comms-tab-rail"
                aria-controls="comms-tabpanel"
                aria-selected={commsTab === 'rail'}
                className={commsTab === 'rail' ? 'active' : ''}
                onClick={() => setCommsTab('rail')}
              >
                {t('tabRail')}
              </button>
              <button
                type="button"
                role="tab"
                id="comms-tab-comms"
                aria-controls="comms-tabpanel"
                aria-selected={commsTab === 'comms'}
                className={commsTab === 'comms' ? 'active' : ''}
                onClick={() => setCommsTab('comms')}
              >
                {t('tabComms')}
              </button>
            </div>
            <div
              id="comms-tabpanel"
              className="comms-tabpanel"
              role="tabpanel"
              aria-labelledby={commsTab === 'rail' ? 'comms-tab-rail' : 'comms-tab-comms'}
            >
              {commsTab === 'rail' ? railInner : comms}
            </div>
          </aside>
          {showHandStrip && commsTab === 'rail' && (
            <div className="game-hand-strip">{handSection}</div>
          )}
        </>
      )}

      {claim && (
        <PaymentModal
          title={claim.kind === 'route' ? t('claimRoute') : t('buildStation')}
          options={claim.payments}
          onPick={confirmPayment}
          onCancel={() => setClaim(null)}
        />
      )}
      {tunnelMine && snapshot.pendingTunnel && (
        <TunnelModal
          revealed={snapshot.pendingTunnel.revealed}
          extraRequired={snapshot.pendingTunnel.extraRequired}
          options={tunnelExtras}
          onCommit={(p) => {
            socket?.resolveTunnel(true, paymentToProto(p));
            setTunnelBase(null);
          }}
          onAbort={() => {
            socket?.resolveTunnel(false);
            setTunnelBase(null);
          }}
        />
      )}
      {phase === Phase.GAME_OVER && <ScoreBoard snapshot={snapshot} onLeave={leave} />}
      <Toast message={notice} variant="toast-notice" />
      <Toast
        message={
          rejection && !isChatRejectionKey(rejection.messageKey) ? t('actionRejected') : null
        }
      />
      <AnimationLayer />
    </div>
  );
}
