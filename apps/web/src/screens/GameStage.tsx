// The presentational board + HUD + action handlers, factored out of GameScreen so the same in-game
// experience renders for BOTH a live server game (commands = GameSocket) and the local tutorial /
// encyclopedia sandbox (commands = SandboxSocket). It is a pure function of the passed `snapshot`
// plus the global display prefs; an optional `overlay` slot carries the tutorial coachmark/spotlight.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Phase, type GameSnapshot } from '@trm/proto';
import type { RouteDef } from '@trm/map-data';
import type { RoomMember } from '../net/rest';
import { useGameStore, type RejectionInfo } from '../store/game';
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
import { skyLanternSurcharge, freeStationAvailable, eventRejectionHintKey } from '../game/events';
import type { GameCommands } from '../net/commands';
import type { BoardFrameTarget } from '../game/boardView';
import { gateFlags, type ActionGate } from '../features/tutorial/types';
import { Board } from '../components/Board';
import { EventsPanel } from '../components/EventsPanel';
import { CardMarket } from '../components/CardMarket';
import { PlayerHand } from '../components/PlayerHand';
import { PlayerTrackers } from '../components/PlayerTrackers';
import { TicketPanel } from '../components/TicketPanel';
import { PaymentModal } from '../components/PaymentModal';
import { TicketChooser } from '../components/TicketChooser';
import { TunnelModal } from '../components/TunnelModal';
import { ScoreBoard } from '../components/ScoreBoard';
import { AnimationLayer } from '../components/AnimationLayer';
import { useAnimationsStore } from '../store/animations';
import { CommsPanel } from '../components/CommsPanel';
import { useAnimationDriver } from '../hooks/useAnimationDriver';
import { useSoundDriver } from '../hooks/useSoundDriver';
import { PHONE_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import '../styles/game.css';
import '../styles/animations.css';

type Claim =
  | { kind: 'route'; route: RouteDef; payments: Payment[] }
  | { kind: 'station'; cityId: string; payments: Payment[] };

/** Phone bottom-dock panels: the rail's sections plus the log/chat, one visible at a time. */
type DockTab = 'hand' | 'draw' | 'missions' | 'players' | 'comms';

export interface GameStageProps {
  snapshot: GameSnapshot;
  /** The live socket or the local sandbox; null briefly while a live game (re)connects. */
  commands: GameCommands | null;
  onLeave: () => void;
  /** Room membership + advisory rematch votes, for the post-game-over ScoreBoard. Undefined in
   *  sandbox/tutorial/replay contexts, where there's no room to rematch. */
  isHost?: boolean | undefined;
  rematchMembers?: RoomMember[] | undefined;
  onVoteRematch?: ((wantsRematch: boolean) => void) | undefined;
  onPlayAgain?: (() => void) | undefined;
  /** Tutorial / encyclopedia overlay rendered above the board + HUD. */
  overlay?: ReactNode;
  /** Cities the tutorial wants glowed this beat (merged with any ticket-endpoint highlights). */
  spotlightCities?: string[] | undefined;
  /** Sandbox (tutorial/encyclopedia): suppress the live camera broadcast on the board. */
  sandbox?: boolean | undefined;
  /** Tutorial auto-pan target (sandbox only); live game leaves this undefined. */
  frameTarget?: BoardFrameTarget | null | undefined;
  /** Tutorial only: the current beat's interaction gate. An `await` beat's expected action keeps
   *  only the matching affordance live; a `'locked'` gate (narration / scripted / done) disables
   *  every affordance, so a stray click can't change phase and strand the lesson. */
  actionGate?: ActionGate | null | undefined;
}

export function GameStage({
  snapshot,
  commands,
  onLeave,
  isHost,
  rematchMembers,
  onVoteRematch,
  onPlayAgain,
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
  useSoundDriver(sandbox);

  const [claim, setClaim] = useState<Claim | null>(null);
  // The base payment committed to a pending tunnel claim. Its cards stay in hand until the tunnel
  // resolves, so the surcharge must be enumerated against the hand minus this.
  const [tunnelBase, setTunnelBase] = useState<Payment | null>(null);
  const pushNotification = useAnimationsStore((s) => s.pushNotification);
  // Tracks the last rejection object already turned into a chip, so the push effect below can
  // list its true dependencies (rejection, pushNotification, t) without re-pushing the same
  // rejection when pushNotification/t merely change identity (e.g. a locale switch).
  const pushedRejectionRef = useRef<RejectionInfo | null>(null);
  // Live game: a wide viewport shows comms as its own column; a narrow one tabs between rail↔comms.
  const wide = useMediaQuery('(min-width: 1300px)');
  const [commsTab, setCommsTab] = useState<'rail' | 'comms'>('rail');
  // Phone: the rail becomes a tabbed bottom dock under a full-bleed board. The sandbox
  // (encyclopedia demo, replay) keeps the stacked-column layout so its caption/log anchors stay
  // mounted; the tutorial is NOT a sandbox and runs the dock — see the actionGate effect below.
  const phone = useMediaQuery(PHONE_QUERY) && !sandbox;
  const [dockTab, setDockTab] = useState<DockTab>('hand');
  // Tutorial on phone: a beat awaiting a market action must surface the Draw tab — its target
  // would otherwise sit inside an unselected (unmounted) dock panel and the learner would stall.
  useEffect(() => {
    if (!phone || !actionGate || actionGate === 'locked') return;
    const expect = actionGate.t;
    if (
      expect === 'DRAW_ANY' ||
      expect === 'DRAW_BLIND' ||
      expect === 'DRAW_FACEUP' ||
      expect === 'DRAW_TICKETS'
    ) {
      setDockTab('draw');
    }
  }, [phone, actionGate]);

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
    if (!rejection || rejection === pushedRejectionRef.current) return;
    pushedRejectionRef.current = rejection;
    if (isChatRejectionKey(rejection.messageKey)) return;
    pushNotification({
      variant: 'error',
      text: t(eventRejectionHintKey(rejection.messageKey) ?? 'actionRejected'),
    });
  }, [rejection, pushNotification, t]);

  const me = snapshot.you?.playerId ?? null;
  // No SelfView ⇒ this connection is a spectator: read-only (all affordances gate on me/canAct/canDraw).
  const isSpectator = !snapshot.you;
  const myPub = snapshot.players.find((p) => p.id === me);
  const hand = handFromCounts(snapshot.you?.hand);
  const phase = snapshot.phase;
  const myTurn = isMyTurn(snapshot);
  const canAct = myTurn && phase === Phase.AWAIT_ACTION;
  const canDraw = myTurn && (phase === Phase.AWAIT_ACTION || phase === Phase.DRAWING_CARDS);

  // Tutorial action gate: an `await` beat keeps only its expected affordance live; a `'locked'` gate
  // (narration / scripted / done) disables them all — so a stray click can't change phase and
  // dead-end the lesson. No gate (live game) ⇒ every affordance enabled.
  const allow = gateFlags(actionGate);
  const boardCanAct = canAct && (allow.claim || allow.station);
  const marketCanDraw = canDraw && allow.draw;

  // Random-events payment mirrors — derived exclusively from the snapshot so the offered options
  // agree with the server's validation (sky-lantern +1-card surcharge; gala zero-cost station).
  const randomEvents = snapshot.randomEvents;
  const pickRoute = (routeId: string) => {
    const route = routeById.get(routeId);
    if (!route) return;
    const extra = skyLanternSurcharge(randomEvents, routeId);
    const payments = enumerateRoutePayments(hand, route, extra);
    if (payments.length) {
      setClaim({ kind: 'route', route, payments });
      return;
    }
    const s = routeShortfall(hand, route, extra);
    pushNotification({
      variant: 'notice',
      text:
        s.kind === 'locos'
          ? t('insufficientLocos', { need: s.need, have: s.have })
          : t('insufficientCards', { need: s.need, have: s.have }),
    });
  };
  const pickCity = (cityId: string) => {
    const remaining = myPub?.stationsRemaining ?? 0;
    if (remaining <= 0) {
      pushNotification({ variant: 'notice', text: t('noStationsLeft') });
      return;
    }
    const cost = 3 - remaining + 1;
    const freeStation = freeStationAvailable(randomEvents);
    const payments = enumerateStationPayments(hand, cost, freeStation);
    if (payments.length) {
      setClaim({ kind: 'station', cityId, payments });
      return;
    }
    const s = stationShortfall(hand, cost);
    pushNotification({
      variant: 'notice',
      text: t('insufficientCards', { need: s.need, have: s.have }),
    });
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
          disabled={!canAct || snapshot.ticketDeckShortCount === 0 || !allow.tickets}
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
      confirmDisabled={!allow.keep}
      onConfirm={confirmKeep}
    />
  ) : boardLayout === 'rail' ? (
    <>
      <EventsPanel />
      {trackers}
      {market}
      {handSection}
      {ticketsSection}
    </>
  ) : (
    <>
      <EventsPanel />
      {trackers}
      {market}
      {ticketsSection}
    </>
  );
  const showHandStrip = !needKeep && boardLayout === 'tray';
  // Chat/comms is a live-multiplayer feature; the tutorial/encyclopedia sandbox has none.
  const comms = sandbox ? null : <CommsPanel chatDisabled={isSpectator} />;

  return (
    <div
      className={`game ${phone ? 'game--dock' : `game--${boardLayout}`}${sandbox ? ' game--sandbox' : ''}`}
    >
      {isSpectator && (
        <div className="spectator-banner" role="status">
          <strong>{t('spectating')}</strong> — {t('spectatingHint')}
        </div>
      )}
      {boardPanel}
      {phone ? (
        // Phone: a bottom dock replaces rail/tray/comms wholesale — the persisted boardLayout
        // pref is deliberately ignored here, since a tabbed dock is the only layout that keeps
        // the (very vertical) board visible while a panel is open.
        <div className={`game-dock${needKeep ? ' game-dock--chooser' : ''}`}>
          {needKeep ? (
            <div className="dock-panel">{railInner}</div>
          ) : (
            <>
              <div className="dock-tabs" role="tablist" aria-label={t('dockTabsLabel')}>
                {(
                  [
                    ['hand', t('cards'), myPub?.handCount ?? 0],
                    ['draw', t('dockDraw'), null],
                    ['missions', t('tickets'), snapshot.you?.keptTicketIds.length ?? 0],
                    ['players', t('dockPlayers'), null],
                    ['comms', t('tabComms'), null],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`dock-tab-${key}`}
                    aria-controls="dock-tabpanel"
                    aria-selected={dockTab === key}
                    className={dockTab === key ? 'active' : ''}
                    onClick={() => setDockTab(key)}
                  >
                    {label}
                    {count !== null && <span className="tray-count">{count}</span>}
                  </button>
                ))}
              </div>
              <div
                id="dock-tabpanel"
                className="dock-panel"
                role="tabpanel"
                aria-labelledby={`dock-tab-${dockTab}`}
              >
                {dockTab === 'hand'
                  ? handSection
                  : dockTab === 'draw'
                    ? market
                    : dockTab === 'missions'
                      ? ticketsSection
                      : dockTab === 'players'
                        ? (
                            <>
                              <EventsPanel />
                              {trackers}
                            </>
                          )
                        : comms}
              </div>
            </>
          )}
        </div>
      ) : sandbox ? (
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
      {phase === Phase.GAME_OVER && (
        <ScoreBoard
          snapshot={snapshot}
          onLeave={onLeave}
          isHost={isHost}
          members={rematchMembers}
          onVote={onVoteRematch}
          onPlayAgain={onPlayAgain}
        />
      )}
      <AnimationLayer />
      {overlay}
    </div>
  );
}
