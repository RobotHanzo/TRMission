// The presentational board + HUD + action handlers (ports the web GameStage), rendered for BOTH a
// live server game (commands = GameSocket) and the local offline/tutorial sandbox (P3/P4). A pure
// function of the passed snapshot plus display prefs. Adaptive tiers by window width instead of
// the web's media queries: compact (<700dp) docks the HUD under a full-bleed board; two-pane
// (700–999) adds the rail; three-pane (≥1000) adds a dedicated comms column. The web's
// `boardLayout` pref is deliberately ignored — the dock/panes are the only layouts that keep the
// (very vertical) board visible on a handheld.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Phase, type GameSnapshot } from '@trm/proto';
import type { RoomMember } from '../net/rest';
import { useGameStore, type RejectionInfo } from '../store/game';
import { useUi } from '../store/ui';
import { useAnimationsStore } from '../store/animations';
import { ticketById } from '../game/content';
import { completedByPlayer } from '../game/tickets';
import { isMyTurn } from '../game/view';
import { isChatRejectionKey } from '../game/chatErrors';
import { eventRejectionHintKey, hasActiveEvent } from '../game/events';
import { gateAllowsTarget, gateFlags, type ActionGate } from '../game/actionGate';
import { TurnBanner } from '../components/game/TurnBanner';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../features/tutorial/targets';
import { useAnimationDriver } from '../hooks/useAnimationDriver';
import { useSoundDriver } from '../hooks/useSoundDriver';
import { useHaptics } from '../game/useHaptics';
import { useClaimFlow } from '../game/useClaimFlow';
import type { GameCommands } from '../net/commands';
import type { BoardFrameTarget } from '../board/frameTarget';
import { BoardView } from '../board/BoardView';
import { EventsPanel } from '../components/game/EventsPanel';
import { EventPhaseBar, EventTurnActions } from '../components/game/EventActions';
import { CardMarket } from '../components/game/CardMarket';
import { PlayerHand } from '../components/game/PlayerHand';
import { PlayerTrackers } from '../components/game/PlayerTrackers';
import { TicketPanel } from '../components/game/TicketPanel';
import { PaymentModal } from '../components/game/PaymentModal';
import { TicketChooser } from '../components/game/TicketChooser';
import { TunnelModal } from '../components/game/TunnelModal';
import { ScoreBoard } from '../components/game/ScoreBoard';
import { CommsPanel } from '../components/game/CommsPanel';
import { AnimationLayer } from '../components/game/AnimationLayer';
import { registerAnimTarget } from '../components/game/animTargets';
import { dockTabs, stageTier, type DockTabKey } from './stageLayout';

export interface GameStageProps {
  snapshot: GameSnapshot;
  /** The live socket or the local sandbox; null briefly while a live game (re)connects. */
  commands: GameCommands | null;
  onLeave: () => void;
  /** Room membership + advisory rematch votes, for the post-game-over ScoreBoard. Undefined in
   *  sandbox/tutorial contexts, where there's no room to rematch. */
  isHost?: boolean | undefined;
  rematchMembers?: RoomMember[] | undefined;
  onVoteRematch?: ((wantsRematch: boolean) => void) | undefined;
  onPlayAgain?: (() => void) | undefined;
  /** Tutorial / encyclopedia overlay rendered above the board + HUD. */
  overlay?: ReactNode;
  /** Cities the tutorial wants glowed this beat (merged with any ticket-endpoint highlights). */
  spotlightCities?: string[] | undefined;
  /** Sandbox (offline/tutorial): suppress the live camera broadcast on the board. */
  sandbox?: boolean | undefined;
  /** Tutorial auto-pan target (sandbox only); live game leaves this undefined. */
  frameTarget?: BoardFrameTarget | null | undefined;
  /** Tutorial only: the current beat's interaction gate (see game/actionGate.ts). */
  actionGate?: ActionGate | null | undefined;
  /** Tutorial only: fires whenever the payment-choice modal opens/closes, so the coachmark can
   *  redirect its spotlight + copy to the payment dialog once the learner's tap opens it. */
  onPendingClaim?: ((kind: 'route' | 'station' | null) => void) | undefined;
}

const RAIL_WIDTH = 360;
const COMMS_WIDTH = 320;

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
  onPendingClaim,
}: GameStageProps) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const colorBlind = useUi((s) => s.colorBlind);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const tier = stageTier(width);
  useAnimationDriver();
  useSoundDriver(sandbox);
  useHaptics();
  // Tutorial spotlight anchor for the draw-tickets button (a no-op outside the tutorial provider).
  const drawTicketsAnchor = useTutorialAnchor(TUTORIAL_ANCHORS.drawTickets);

  const rejection = useGameStore((s) => s.rejection);
  const setRejection = useGameStore((s) => s.setRejection);
  const pushNotification = useAnimationsStore((s) => s.pushNotification);
  // Tracks the last rejection already turned into a chip so the push effect can list its true
  // deps without re-pushing the same rejection when t/pushNotification change identity.
  const pushedRejectionRef = useRef<RejectionInfo | null>(null);

  const [dockTab, setDockTab] = useState<DockTabKey>('hand');
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
    if (!rejection || rejection === pushedRejectionRef.current) return;
    pushedRejectionRef.current = rejection;
    if (isChatRejectionKey(rejection.messageKey)) return;
    pushNotification({
      variant: 'error',
      text: t(eventRejectionHintKey(rejection.messageKey) ?? 'actionRejected'),
    });
  }, [rejection, pushNotification, t]);

  const me = snapshot.you?.playerId ?? null;
  // No SelfView ⇒ this connection is a spectator: read-only (everything gates on me/canAct/canDraw).
  const isSpectator = !snapshot.you;
  const myPub = snapshot.players.find((p) => p.id === me);
  const phase = snapshot.phase;
  const myTurn = isMyTurn(snapshot);
  const canAct = myTurn && phase === Phase.AWAIT_ACTION;
  const canDraw = myTurn && (phase === Phase.AWAIT_ACTION || phase === Phase.DRAWING_CARDS);

  // Tutorial action gate: an `await` beat keeps only its expected affordance live; 'locked'
  // disables them all. No gate (live game) ⇒ every affordance enabled. Claim and station are
  // gated INDEPENDENTLY (not OR'd into one board-wide flag) so e.g. a CLAIM_ROUTE beat doesn't
  // leave every city on the map still tappable for BUILD_STATION, and vice versa.
  const allow = gateFlags(actionGate);
  const boardCanClaim = canAct && allow.claim;
  const boardCanBuildStation = canAct && allow.station;
  const marketCanDraw = canDraw && allow.draw;

  const flow = useClaimFlow(snapshot, commands);
  // Tutorial: let the coachmark know a payment choice just opened (or closed), so it can redirect
  // its spotlight + copy to the dialog instead of the map target that opened it.
  const claimKind = flow.claim?.kind ?? null;
  useEffect(() => {
    onPendingClaim?.(claimKind === 'repair' ? null : claimKind);
  }, [claimKind, onPendingClaim]);
  // Tutorial: while an await beat is active, only its expected affordance accepts a board tap at
  // all, and — when the beat names a specific route/city — only THAT target. Everything else is
  // ignored outright, so a stray tap can't spend the learner's hand on the wrong claim or strand
  // the beat on a non-match. Live games pass no gate ⇒ these are transparent wrappers.
  const pickRoute = (routeId: string): void => {
    if (!gateAllowsTarget(actionGate, 'route', routeId)) return;
    flow.pickRoute(routeId);
  };
  const pickCity = (cityId: string): void => {
    if (!gateAllowsTarget(actionGate, 'city', cityId)) return;
    flow.pickCity(cityId);
  };

  // Tutorial on compact: a beat awaiting a market action must surface the Draw tab — its target
  // would otherwise sit inside an unselected (unmounted) dock panel and the learner would stall.
  const compact = tier === 'compact';
  useEffect(() => {
    if (!compact || !actionGate || actionGate === 'locked') return;
    const expect = actionGate.t;
    if (
      expect === 'DRAW_ANY' ||
      expect === 'DRAW_BLIND' ||
      expect === 'DRAW_FACEUP' ||
      expect === 'DRAW_TICKETS'
    ) {
      setDockTab('draw');
    }
  }, [compact, actionGate]);

  const needKeep =
    (phase === Phase.SETUP_TICKETS || phase === Phase.TICKET_SELECTION) &&
    (snapshot.you?.pendingOfferTicketIds.length ?? 0) > 0;
  const confirmKeep = (ids: string[]): void => {
    if (!commands) return;
    if (phase === Phase.SETUP_TICKETS) commands.keepInitialTickets(ids);
    else commands.keepTickets(ids);
  };
  // While choosing tickets the board stays interactive, so softly glow the endpoint cities of the
  // offered tickets to help preview the railways they need.
  const ticketEndpoints = needKeep
    ? new Set(
        (snapshot.you?.pendingOfferTicketIds ?? []).flatMap((id) => {
          const def = ticketById.get(id);
          return def ? [def.a as string, def.b as string] : [];
        }),
      )
    : undefined;
  // Merge the tutorial's spotlight cities with any ticket-endpoint glow.
  const highlightCities =
    spotlightCities && spotlightCities.length
      ? new Set<string>([...(ticketEndpoints ?? []), ...spotlightCities])
      : ticketEndpoints;

  const board = (
    <BoardView
      snapshot={snapshot}
      locale={locale}
      colorBlind={colorBlind}
      canClaim={boardCanClaim}
      canBuildStation={boardCanBuildStation}
      onPickRoute={pickRoute}
      onPickCity={pickCity}
      highlightCities={highlightCities}
      sandbox={sandbox}
      frameTarget={frameTarget}
    />
  );

  const trackers = <PlayerTrackers snapshot={snapshot} />;
  // The blocking event-phase prompt sits above the board in every tier so a required
  // lantern/draft/hive choice is never buried inside an unselected dock tab.
  const eventPhaseBar = <EventPhaseBar snapshot={snapshot} commands={commands} locale={locale} />;
  // Whose turn + connection state, persistent across every tier (web's AppHeader equivalent).
  const turnBanner = <TurnBanner snapshot={snapshot} sandbox={sandbox} />;
  const market = (
    <View style={styles.marketBlock}>
      <CardMarket
        snapshot={snapshot}
        canDraw={marketCanDraw}
        onDrawFaceUp={(slot) => commands?.drawFaceUp(slot)}
        onDrawBlind={() => commands?.drawBlind()}
        blockFaceupLocomotives={hasActiveEvent(snapshot.randomEvents, 'ALL_SEATS_RESERVED')}
      />
      <Pressable
        {...drawTicketsAnchor}
        style={({ pressed }) => [
          styles.drawTicketsBtn,
          (!canAct || snapshot.ticketDeckShortCount === 0 || !allow.tickets) &&
            styles.drawTicketsDisabled,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        disabled={!canAct || snapshot.ticketDeckShortCount === 0 || !allow.tickets}
        onPress={() => commands?.drawTickets()}
      >
        <Text style={styles.drawTicketsText}>
          {t('drawTickets')}
          {snapshot.ticketDeckShortCount === 0
            ? ` (${t('deckEmpty')})`
            : ` (${snapshot.ticketDeckShortCount})`}
        </Text>
      </Pressable>
      {canAct && snapshot.you?.youMustPass && (
        <Pressable
          style={({ pressed }) => [styles.drawTicketsBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          onPress={() => commands?.pass()}
        >
          <Text style={styles.drawTicketsText}>{t('passTurn')}</Text>
        </Pressable>
      )}
      <EventTurnActions
        snapshot={snapshot}
        commands={commands}
        canAct={canAct}
        locale={locale}
        onRepair={flow.startRepair}
      />
    </View>
  );
  const handSection = (
    <View style={styles.traySection}>
      <TrayHead title={t('cards')} count={myPub?.handCount ?? 0} />
      <PlayerHand hand={snapshot.you?.hand} />
    </View>
  );
  const ticketsSection = (
    <View style={styles.traySection}>
      <TrayHead title={t('tickets')} count={snapshot.you?.keptTicketIds.length ?? 0} />
      <TicketPanel
        ticketIds={snapshot.you?.keptTicketIds ?? []}
        completedIds={me ? completedByPlayer(snapshot).get(me) : undefined}
      />
    </View>
  );

  const chooser = (
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
  );

  // The rail's inner content: the ticket chooser while drafting, else the stacked panels.
  const railInner = needKeep ? (
    chooser
  ) : (
    <>
      <EventsPanel />
      {trackers}
      {market}
      {handSection}
      {ticketsSection}
    </>
  );
  // Chat/comms is a live-multiplayer feature; the offline/tutorial sandbox has none.
  const comms = sandbox ? <View /> : <CommsPanel chatDisabled={isSpectator} />;

  const spectatorBanner = isSpectator ? (
    <View style={styles.spectatorBanner} accessibilityRole="text">
      <Text style={styles.spectatorText}>
        <Text style={styles.spectatorStrong}>{t('spectating')}</Text> — {t('spectatingHint')}
      </Text>
    </View>
  ) : null;

  const overlays = (
    <>
      {flow.claim && (
        <PaymentModal
          title={
            flow.claim.kind === 'route'
              ? t('claimRoute')
              : flow.claim.kind === 'station'
                ? t('buildStation')
                : t('events.repairRoute')
          }
          options={flow.claim.payments}
          onPick={flow.confirmPayment}
          onCancel={flow.cancelClaim}
        />
      )}
      {/* The tunnel reveal is public — everyone watches; only the claimant gets the interactive
          payment options (their hand stays secret). */}
      {phase === Phase.TUNNEL_PENDING && snapshot.pendingTunnel && (
        <TunnelModal
          revealed={snapshot.pendingTunnel.revealed}
          extraRequired={snapshot.pendingTunnel.extraRequired}
          playedColor={snapshot.pendingTunnel.playedColor}
          options={flow.tunnelExtras}
          spectator={!flow.tunnelMine}
          onCommit={flow.onTunnelCommit}
          onAbort={flow.onTunnelAbort}
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
      {overlay}
      <AnimationLayer />
    </>
  );

  if (compact) {
    // A bottom dock replaces rail/comms wholesale: a tabbed panel under a full-bleed board. The
    // ticket chooser takes over the whole dock. (Unlike the web, the sandbox docks too — the
    // stacked-column exception existed for the web encyclopedia's caption anchors; on a phone a
    // dock is the only layout that keeps the board visible. Sandbox just drops the comms tab.)
    const tabs = dockTabs(!!snapshot.randomEvents).filter(
      (tab) => !(sandbox && tab.key === 'comms'),
    );
    const countOf = (source: 'hand' | 'missions' | null): number | null =>
      source === 'hand'
        ? (myPub?.handCount ?? 0)
        : source === 'missions'
          ? (snapshot.you?.keptTicketIds.length ?? 0)
          : null;
    return (
      <View style={styles.fill}>
        {spectatorBanner}
        {turnBanner}
        {eventPhaseBar}
        <View style={styles.fill}>{board}</View>
        <View
          // The dock is the only always-mounted HUD surface on phones (its panels swap by tab).
          // Registering it as a flight anchor gives card draws a destination even while the Hand
          // tab is inactive — otherwise the flight has no `hand` target and silently no-ops.
          ref={(v) => registerAnimTarget('dock', v)}
          collapsable={false}
          style={[styles.dock, { height: Math.round(height * 0.45), paddingBottom: insets.bottom }]}
        >
          {needKeep ? (
            <ScrollView contentContainerStyle={styles.dockPanel}>{chooser}</ScrollView>
          ) : (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.dockTabs}
                contentContainerStyle={styles.dockTabsRow}
              >
                {tabs.map(({ key, labelKey, countSource }) => {
                  const count = countOf(countSource);
                  const active = dockTab === key;
                  return (
                    <Pressable
                      key={key}
                      style={[styles.dockTabBtn, active && styles.dockTabActive]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      onPress={() => setDockTab(key)}
                    >
                      <Text style={[styles.dockTabText, active && styles.dockTabTextActive]}>
                        {t(labelKey)}
                        {count !== null ? ` ${count}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <ScrollView contentContainerStyle={styles.dockPanel}>
                {dockTab === 'hand' ? (
                  handSection
                ) : dockTab === 'draw' ? (
                  market
                ) : dockTab === 'missions' ? (
                  ticketsSection
                ) : dockTab === 'events' ? (
                  <EventsPanel />
                ) : dockTab === 'players' ? (
                  trackers
                ) : (
                  comms
                )}
              </ScrollView>
            </>
          )}
        </View>
        {overlays}
      </View>
    );
  }

  if (tier === 'three-pane') {
    return (
      <View style={styles.fill}>
        {spectatorBanner}
        {turnBanner}
        {eventPhaseBar}
        <View style={styles.row}>
          <View style={styles.fill}>{board}</View>
          <ScrollView style={styles.rail} contentContainerStyle={styles.railContent}>
            {railInner}
          </ScrollView>
          {!sandbox && (
            <View style={[styles.commsPane, { paddingBottom: insets.bottom }]}>{comms}</View>
          )}
        </View>
        {overlays}
      </View>
    );
  }

  // two-pane: board + rail, with a rail↔comms tab pair (ports the web narrow-desktop branch).
  return (
    <View style={styles.fill}>
      {spectatorBanner}
      {turnBanner}
      {eventPhaseBar}
      <View style={styles.row}>
        <View style={styles.fill}>{board}</View>
        <View style={styles.rail}>
          {!sandbox && (
            <View style={styles.commsTabs} accessibilityRole="tablist">
              {(['rail', 'comms'] as const).map((key) => (
                <Pressable
                  key={key}
                  style={[styles.commsTabBtn, commsTab === key && styles.dockTabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: commsTab === key }}
                  onPress={() => setCommsTab(key)}
                >
                  <Text style={[styles.dockTabText, commsTab === key && styles.dockTabTextActive]}>
                    {t(key === 'rail' ? 'tabRail' : 'tabComms')}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <ScrollView style={styles.fill} contentContainerStyle={styles.railContent}>
            {commsTab === 'rail' || sandbox ? railInner : comms}
          </ScrollView>
        </View>
      </View>
      {overlays}
    </View>
  );
}

function TrayHead({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.trayHead}>
      <Text style={styles.trayTitle}>{title}</Text>
      <Text style={styles.trayCount}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  spectatorBanner: {
    backgroundColor: 'rgba(15,95,166,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  spectatorText: { fontSize: 12 },
  spectatorStrong: { fontWeight: '700' },
  dock: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.12)',
    backgroundColor: '#faf7f0',
  },
  dockTabs: { flexGrow: 0 },
  dockTabsRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 6, paddingVertical: 6 },
  dockTabBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 40,
    justifyContent: 'center',
  },
  dockTabActive: { backgroundColor: 'rgba(15,95,166,0.12)' },
  dockTabText: { fontSize: 13, fontWeight: '600', color: '#4b5563' },
  dockTabTextActive: { color: '#0f5fa6' },
  dockPanel: { padding: 10, gap: 8 },
  rail: {
    width: RAIL_WIDTH,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(0,0,0,0.12)',
    backgroundColor: '#faf7f0',
  },
  railContent: { padding: 10, gap: 12 },
  commsPane: {
    width: COMMS_WIDTH,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(0,0,0,0.12)',
    backgroundColor: '#faf7f0',
    padding: 10,
  },
  commsTabs: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  commsTabBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    minHeight: 40,
    justifyContent: 'center',
  },
  marketBlock: { gap: 8 },
  drawTicketsBtn: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#ee6b1f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawTicketsDisabled: { opacity: 0.45 },
  drawTicketsText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.8 },
  traySection: { gap: 6 },
  trayHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trayTitle: { fontSize: 13, fontWeight: '700' },
  trayCount: {
    minWidth: 20,
    textAlign: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.08)',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
