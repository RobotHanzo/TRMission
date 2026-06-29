// The presentational board + HUD + action handlers, factored out of GameScreen so the same in-game
// experience renders for BOTH a live server game (commands = GameSocket) and the local tutorial /
// encyclopedia sandbox (commands = SandboxSocket). It is a pure function of the passed `snapshot`
// plus the global display prefs; an optional `overlay` slot carries the tutorial coachmark/spotlight.
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Phase, type GameSnapshot } from '@trm/proto';
import type { RouteDef } from '@trm/map-data';
import { useGameStore } from '../store/game';
import { useUi } from '../store/ui';
import { routeById, ticketById } from '../game/content';
import { completedByPlayer } from '../game/tickets';
import { isMyTurn } from '../game/view';
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
import { isChatRejectionKey } from '../game/chatErrors';
import type { GameCommands } from '../net/commands';
import type { BoardFrameTarget } from '../game/boardView';
import type { ExpectSpec } from '../features/tutorial/types';
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

export interface GameStageProps {
  snapshot: GameSnapshot;
  /** The live socket or the local sandbox; null briefly while a live game (re)connects. */
  commands: GameCommands | null;
  onLeave: () => void;
  /** Tutorial / encyclopedia overlay rendered above the board + HUD. */
  overlay?: ReactNode;
  /** Cities the tutorial wants glowed this beat (merged with any ticket-endpoint highlights). */
  spotlightCities?: string[] | undefined;
  /** Sandbox (tutorial/encyclopedia): suppress the live camera broadcast on the board. */
  sandbox?: boolean | undefined;
  /** Tutorial auto-pan target (sandbox only); live game leaves this undefined. */
  frameTarget?: BoardFrameTarget | null | undefined;
  /** Tutorial only: the current `await` beat's expected action. When set, affordances that don't
   *  match it are disabled, so a stray click can't change phase and strand the lesson. */
  actionGate?: ExpectSpec | null | undefined;
}

export function GameStage({
  snapshot,
  commands,
  onLeave,
  overlay,
  spotlightCities,
  sandbox,
  frameTarget,
  actionGate,
}: GameStageProps) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const colorBlind = useUi((s) => s.colorBlind);
  const boardLayout = useUi((s) => s.boardLayout);

  const rejection = useGameStore((s) => s.rejection);
  const setRejection = useGameStore((s) => s.setRejection);

  // Translate events + snapshot diffs into animations (claim glow, draws, fanfare, …) and sounds.
  useAnimationDriver();
  useSoundDriver();

  const [claim, setClaim] = useState<Claim | null>(null);
  // The base payment committed to a pending tunnel claim. Its cards stay in hand until the tunnel
  // resolves, so the surcharge must be enumerated against the hand minus this.
  const [tunnelBase, setTunnelBase] = useState<Payment | null>(null);
  // Client-side nudge (e.g. "not enough cards") shown when a click can't open a modal.
  const [notice, setNotice] = useState<string | null>(null);
  // Live game: a wide viewport shows comms as its own column; a narrow one tabs between rail↔comms.
  const wide = useMediaQuery('(min-width: 1300px)');
  const [commsTab, setCommsTab] = useState<'rail' | 'comms'>('rail');

  const version = snapshot.stateVersion;
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

  const me = snapshot.you?.playerId ?? null;
  // No SelfView ⇒ this connection is a spectator: read-only (all affordances gate on me/canAct/canDraw).
  const isSpectator = !snapshot.you;
  const myPub = snapshot.players.find((p) => p.id === me);
  const hand = handFromCounts(snapshot.you?.hand);
  const phase = snapshot.phase;
  const myTurn = isMyTurn(snapshot);
  const canAct = myTurn && phase === Phase.AWAIT_ACTION;
  const canDraw = myTurn && (phase === Phase.AWAIT_ACTION || phase === Phase.DRAWING_CARDS);

  // Tutorial action gate: when an `await` beat names the action it wants, disable the affordances
  // that don't match it (e.g. draw-tickets or claiming while the lesson asks for a train-card draw),
  // so a stray click can't change phase and dead-end the lesson. No gate (live game) ⇒ all enabled.
  const gate = actionGate ?? null;
  const allowDraw =
    !gate || gate.t === 'DRAW_ANY' || gate.t === 'DRAW_BLIND' || gate.t === 'DRAW_FACEUP';
  const allowTickets = !gate || gate.t === 'DRAW_TICKETS';
  const allowClaim = !gate || gate.t === 'CLAIM_ROUTE';
  const allowStation = !gate || gate.t === 'BUILD_STATION';
  const boardCanAct = canAct && (allowClaim || allowStation);
  const marketCanDraw = canDraw && allowDraw;

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
    if (!commands || !claim) return;
    if (claim.kind === 'route') {
      if (claim.route.isTunnel) setTunnelBase(p);
      commands.claimRoute(claim.route.id as string, paymentToProto(p));
    } else {
      commands.buildStation(claim.cityId, paymentToProto(p));
    }
    setClaim(null);
  };

  const needKeep =
    (phase === Phase.SETUP_TICKETS || phase === Phase.TICKET_SELECTION) &&
    (snapshot.you?.pendingOfferTicketIds.length ?? 0) > 0;
  const confirmKeep = (ids: string[]) => {
    if (!commands) return;
    if (phase === Phase.SETUP_TICKETS) commands.keepInitialTickets(ids);
    else commands.keepTickets(ids);
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

  // Merge the tutorial's spotlight cities with any ticket-endpoint glow.
  const highlightCities =
    spotlightCities && spotlightCities.length
      ? new Set<string>([...(ticketEndpoints ?? []), ...spotlightCities])
      : ticketEndpoints;

  const boardPanel = (
    <div className="game-board">
      <Board
        snapshot={snapshot}
        locale={locale}
        colorBlind={colorBlind}
        canAct={boardCanAct}
        onPickRoute={pickRoute}
        onPickCity={pickCity}
        highlightCities={highlightCities}
        sandbox={sandbox}
        frameTarget={frameTarget}
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
        canDraw={marketCanDraw}
        onDrawFaceUp={(slot) => commands?.drawFaceUp(slot)}
        onDrawBlind={() => commands?.drawBlind()}
      />
      <div className="hud-actions">
        <button
          className="accent"
          data-anim="draw-tickets"
          disabled={!canAct || snapshot.ticketDeckShortCount === 0 || !allowTickets}
          onClick={() => commands?.drawTickets()}
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

  // The rail's inner content: the ticket chooser while drafting, else trackers/market/(hand)/missions.
  const railInner = needKeep ? (
    // Choosing tickets takes over the rail so the board stays visible and pan/zoomable; the hand
    // and kept missions move into the chooser's own peek toggles.
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
  // Chat/comms is a live-multiplayer feature; the tutorial/encyclopedia sandbox has none.
  const comms = sandbox ? null : <CommsPanel chatDisabled={isSpectator} />;

  return (
    <div className={`game game--${boardLayout}${sandbox ? ' game--sandbox' : ''}`}>
      {isSpectator && (
        <div className="spectator-banner" role="status">
          <strong>{t('spectating')}</strong> — {t('spectatingHint')}
        </div>
      )}
      {boardPanel}
      {sandbox ? (
        // Sandbox (tutorial/encyclopedia): no comms — the plain rail (+ hand strip in tray mode).
        <>
          <aside className="game-rail">{railInner}</aside>
          {showHandStrip && <div className="game-hand-strip">{handSection}</div>}
        </>
      ) : wide ? (
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
      {/* The tunnel reveal is public, so everyone watches the draw + surcharge. Only the
          claimant gets the interactive payment options (their hand stays secret); spectators
          see a read-only colour-only surcharge combination instead. */}
      {phase === Phase.TUNNEL_PENDING && snapshot.pendingTunnel && (
        <TunnelModal
          revealed={snapshot.pendingTunnel.revealed}
          extraRequired={snapshot.pendingTunnel.extraRequired}
          playedColor={snapshot.pendingTunnel.playedColor}
          options={tunnelExtras}
          spectator={!tunnelMine}
          onCommit={(p) => {
            commands?.resolveTunnel(true, paymentToProto(p));
            setTunnelBase(null);
          }}
          onAbort={() => {
            commands?.resolveTunnel(false);
            setTunnelBase(null);
          }}
        />
      )}
      {phase === Phase.GAME_OVER && <ScoreBoard snapshot={snapshot} onLeave={onLeave} />}
      <Toast message={notice} variant="toast-notice" />
      <Toast
        message={
          rejection && !isChatRejectionKey(rejection.messageKey) ? t('actionRejected') : null
        }
      />
      <AnimationLayer />
      {overlay}
    </div>
  );
}
