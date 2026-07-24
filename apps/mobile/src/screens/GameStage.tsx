// The presentational board + HUD + action handlers (ports the web GameStage), rendered for BOTH a
// live server game (commands = GameSocket) and the local offline/tutorial sandbox (P3/P4). A pure
// function of the passed snapshot plus display prefs. Adaptive tiers by window width instead of
// the web's media queries: compact (<700dp) floats the status chips over a full-bleed board and
// docks the HUD in a boarding-pass tray; two-pane (700–999) adds the rail; three-pane (≥1000)
// adds a dedicated comms column. The web's `boardLayout` pref is deliberately ignored — the
// dock/panes are the only layouts that keep the (very vertical) board visible on a handheld.
// Every chrome surface styles through the ChromeTokens theme (gameChrome.tsx); the timetable
// panel voice (TrayHead's dashed leader) is shared with the web's .tray-head.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  ArrowLeft,
  History,
  Layers,
  MessageSquare,
  Sparkles,
  Ticket,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react-native';
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
import { useReducedMotion } from '../hooks/useReducedMotion';
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
import { TeamPoolPanel } from '../components/game/TeamPoolPanel';
import { PlayerTrackers } from '../components/game/PlayerTrackers';
import { TurnCountdown } from '../components/game/TurnCountdown';
import { TicketPanel } from '../components/game/TicketPanel';
import { PaymentModal } from '../components/game/PaymentModal';
import { TicketChooser } from '../components/game/TicketChooser';
import { TunnelModal } from '../components/game/TunnelModal';
import { ScoreBoard } from '../components/game/ScoreBoard';
import { LogPanel } from '../components/game/LogPanel';
import { ChatPanel } from '../components/game/ChatPanel';
import { AnimationLayer } from '../components/game/AnimationLayer';
import { registerAnimTarget } from '../components/game/animTargets';
import { RADIUS, useTheme } from '../theme/useTheme';
import { rgba } from '../theme/shade';
import { GamePanel, TrayHead, panelCardStyle } from '../theme/gameChrome';
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
  /** Encyclopedia demo clip: a passive viewing surface. Hides the leave chip (the demo screen
   *  carries its own navigation) and the turn banner (the viewer never acts), and the compact
   *  dock starts collapsed so the board is the show. */
  demo?: boolean | undefined;
  /** Demo only: the dock tab the CURRENT narration beat talks about (null between HUD beats).
   *  The compact dock follows it — sliding open on that tab while a beat references a HUD
   *  panel, tucking back down to its strip after — so the clip choreographs the tray. */
  demoDock?: DockTabKey | null | undefined;
}

const RAIL_WIDTH = 360;
const COMMS_WIDTH = 320;
/** The boarding-pass dock's rounded lip overlaps the board bottom by this much. */
const DOCK_OVERLAP = 14;
/** Dock header (handle + tab bar) height estimate until the first onLayout corrects it — only
 *  consulted if the dock is collapsed before that measurement lands. */
const DOCK_HEADER_ESTIMATE = 64;
/** Dock collapse/expand travel time (Easing.out(cubic), the app's chrome-motion idiom). */
const DOCK_ANIM_MS = 240;
/** A header-swipe released faster than this (px/s) commits the swipe's direction outright. */
const DOCK_FLING_VELOCITY = 420;

/** Tab glyphs for the phone dock (chrome-only Lucide, like the rest of the app UI). */
const TAB_ICONS: Record<DockTabKey, LucideIcon> = {
  hand: WalletCards,
  draw: Layers,
  missions: Ticket,
  events: Sparkles,
  players: Users,
  log: History,
  comms: MessageSquare,
};

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
  demo,
  demoDock,
}: GameStageProps) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const colorBlind = useUi((s) => s.colorBlind);
  const { tokens } = useTheme();
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
  // Compact only: collapse the dock down to its tab bar so the board gets the full window.
  // A demo clip starts collapsed — the board is the show; beats reopen it (see demoDock).
  const [dockCollapsed, setDockCollapsed] = useState(!!demo);
  const [commsTab, setCommsTab] = useState<'rail' | 'log' | 'comms'>('rail');

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

  // Interactive tutorial on compact: the dock follows the narration, same rule as the demo effect
  // below — a beat awaiting a market action must surface the Draw tab (its target would otherwise
  // sit inside an unselected, unmounted dock panel and the learner would stall), while a
  // claim/build-station/tunnel/info beat instead tucks the dock away so the spotlighted route or
  // city on the board isn't sitting underneath it, unreachable by tap. Guarded off `demo`: the
  // encyclopedia's own effect below (which additionally knows which HUD tab a beat references)
  // owns dock state there.
  const compact = tier === 'compact';
  useEffect(() => {
    if (!compact || demo || !actionGate) return;
    if (actionGate === 'locked') {
      setDockCollapsed(true);
      return;
    }
    const expect = actionGate.t;
    if (
      expect === 'DRAW_ANY' ||
      expect === 'DRAW_BLIND' ||
      expect === 'DRAW_FACEUP' ||
      expect === 'DRAW_TICKETS'
    ) {
      setDockTab('draw');
      // A collapsed dock would leave the beat's target off-screen — pop it back open.
      setDockCollapsed(false);
    } else {
      setDockCollapsed(true);
    }
  }, [compact, demo, actionGate]);

  // Encyclopedia demo: the dock follows the narration. A beat that talks about a HUD panel
  // opens its tab; any other beat tucks the dock back down, handing the window to the board.
  // (A viewer's manual drag still works between beats — the next beat simply re-asserts.)
  useEffect(() => {
    if (!compact || !demo) return;
    if (demoDock) {
      setDockTab(demoDock);
      setDockCollapsed(false);
    } else {
      setDockCollapsed(true);
    }
  }, [compact, demo, demoDock]);

  const needKeep =
    (phase === Phase.SETUP_TICKETS || phase === Phase.TICKET_SELECTION) &&
    (snapshot.you?.pendingOfferTicketIds.length ?? 0) > 0;
  const confirmKeep = (ids: string[]): void => {
    if (!commands) return;
    if (phase === Phase.SETUP_TICKETS) commands.keepInitialTickets(ids);
    else commands.keepTickets(ids);
  };

  // ── Dock motion (compact) ── The dock's height is driven by a 0(collapsed)→1(open) progress
  // shared value so the header can be DRAGGED (height tracks the finger) while handle taps, tab
  // taps, and the tutorial's pop-open all animate through the same path. React state
  // (`dockCollapsed`) stays the source of truth for the TARGET: the effect animates progress
  // toward it, and a drag release writes the settled state back.
  const reducedMotion = useReducedMotion();
  const openHeight = Math.round(height * 0.45);
  const [dockHeaderH, setDockHeaderH] = useState(DOCK_HEADER_ESTIMATE);
  const collapsedHeight = dockHeaderH + insets.bottom;
  // The mandatory ticket chooser overrides a collapsed dock — a required choice must stay
  // visible. Collapsed otherwise shrinks the dock to its tab bar, giving the board the window.
  const dockOpen = needKeep || !dockCollapsed;
  const dockProgress = useSharedValue(dockOpen ? 1 : 0);
  useEffect(() => {
    dockProgress.value = reducedMotion
      ? dockOpen
        ? 1
        : 0
      : withTiming(dockOpen ? 1 : 0, {
          duration: DOCK_ANIM_MS,
          easing: Easing.out(Easing.cubic),
        });
  }, [dockOpen, reducedMotion, dockProgress]);
  const dockAnimStyle = useAnimatedStyle(
    () => ({ height: collapsedHeight + dockProgress.value * (openHeight - collapsedHeight) }),
    [collapsedHeight, openHeight],
  );
  // Header swipe: vertical-only activation (activeOffsetY) so tab taps still register, and an
  // early horizontal fail so the tab bar's own sideways scroll wins its axis.
  //
  // The header rides the dock's top edge, so during a drag it follows the pointer — which means
  // on react-native-web the underlying Pressable still counts the release as a press (native
  // cancels presses when a pan activates; guard both): handle/tab onPress ignores any press
  // landing right after a pan touched the dock.
  const dockDragStamp = useRef(0);
  const markDockDrag = (): void => {
    dockDragStamp.current = Date.now();
  };
  const dragJustEnded = (): boolean => Date.now() - dockDragStamp.current < 300;
  const dockDragFrom = useSharedValue(0);
  const dockPan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-16, 16])
    .onStart(() => {
      dockDragFrom.value = dockProgress.value;
      runOnJS(markDockDrag)();
    })
    .onUpdate((e) => {
      const range = openHeight - collapsedHeight;
      if (range <= 0) return;
      dockProgress.value = Math.min(1, Math.max(0, dockDragFrom.value - e.translationY / range));
    })
    .onEnd((e) => {
      // A fling commits its direction; a slow release settles to the nearer state. The worklet
      // animates immediately (state may not change, e.g. released back where it started) and the
      // state write keeps React — and the needKeep/tutorial effects — in agreement.
      const toOpen =
        e.velocityY <= -DOCK_FLING_VELOCITY ||
        (e.velocityY < DOCK_FLING_VELOCITY && dockProgress.value > 0.5);
      dockProgress.value = withTiming(toOpen ? 1 : 0, {
        duration: 200,
        easing: Easing.out(Easing.cubic),
      });
      runOnJS(markDockDrag)();
      runOnJS(setDockCollapsed)(!toOpen);
    });
  // Direction-aware tab transitions: the incoming panel fades in with a slide from the side its
  // tab sits on. Driven manually (shared value reset per tab change) rather than reanimated
  // entering/exiting layout animations — those silently no-op on the react-native-web harness,
  // where this stays testable. The layout effect runs pre-paint, so the incoming panel's first
  // frame is already transparent (a plain effect would flash it fully opaque for a frame).
  const tabDir = useSharedValue<1 | -1>(1);
  const tabAnim = useSharedValue(1);
  useLayoutEffect(() => {
    if (reducedMotion) {
      tabAnim.value = 1;
      return;
    }
    tabAnim.value = 0;
    tabAnim.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
  }, [dockTab, reducedMotion, tabAnim]);
  const tabAnimStyle = useAnimatedStyle(() => ({
    opacity: tabAnim.value,
    transform: [{ translateX: (1 - tabAnim.value) * 24 * tabDir.value }],
  }));
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
          { backgroundColor: tokens.ember, shadowColor: tokens.ink },
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
          style={({ pressed }) => [
            styles.drawTicketsBtn,
            { backgroundColor: tokens.blue, shadowColor: tokens.ink },
            pressed && styles.pressed,
          ]}
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
  // Timetable panels — every HUD block sits on the same GamePanel sheet with a TrayHead
  // (title ── dashed leader ── count pill), the shared voice with the web's .tray-section.
  const drawSection = (
    <GamePanel>
      <TrayHead title={t('dockDraw')} count={snapshot.deckCount} />
      {market}
    </GamePanel>
  );
  const handSection = (
    <GamePanel>
      <TrayHead title={t('cards')} count={myPub?.handCount ?? 0} />
      <PlayerHand hand={snapshot.you?.hand} />
      <TeamPoolPanel
        snapshot={snapshot}
        onPush={(color) => commands?.pushToTeamPool(color)}
        onTake={(color) => commands?.takeFromTeamPool(color)}
      />
    </GamePanel>
  );
  const ticketsSection = (
    <GamePanel>
      <TrayHead title={t('tickets')} count={snapshot.you?.keptTicketIds.length ?? 0} />
      <TicketPanel
        ticketIds={snapshot.you?.keptTicketIds ?? []}
        completedIds={me ? completedByPlayer(snapshot).get(me) : undefined}
      />
    </GamePanel>
  );
  // The countdown mounts ONCE per stage (its hook drives the warning sounds): floating over the
  // board on compact, atop the players panel on the pane tiers.
  const playersPanel = (withCountdown: boolean) => (
    <GamePanel>
      <TrayHead title={t('dockPlayers')} count={snapshot.players.length} />
      {withCountdown && <TurnCountdown />}
      <PlayerTrackers snapshot={snapshot} />
    </GamePanel>
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
      {playersPanel(true)}
      {drawSection}
      {handSection}
      {ticketsSection}
    </>
  );
  // The action log is just a projection of events that already happened, so it's available in
  // every game — live, offline vs bots, tutorial, or replay. Chat is a live-multiplayer feature
  // only (there's no one to talk to offline, and replay has no live connection to send over).
  const logSection = (
    <View style={[panelCardStyle(tokens), styles.commsCard]}>
      <LogPanel />
    </View>
  );
  const chatSection = sandbox ? null : (
    <View style={[panelCardStyle(tokens), styles.commsCard]}>
      <ChatPanel disabled={isSpectator} />
    </View>
  );

  const spectatorBanner = isSpectator ? (
    <View
      style={[
        styles.spectatorBanner,
        { backgroundColor: tokens.surface, borderColor: tokens.blue, shadowColor: tokens.ink },
      ]}
      accessibilityRole="text"
    >
      <Text style={[styles.spectatorText, { color: tokens.ink }]}>
        <Text style={styles.spectatorStrong}>{t('spectating')}</Text> — {t('spectatingHint')}
      </Text>
    </View>
  ) : null;

  // The floating HUD over the board (every tier — the nav header is hidden on game routes so the
  // board is truly full-bleed): the leave chip where the header's back button sat, status chips
  // centered beside it. The countdown joins only on compact, where no players panel carries it.
  const floatHud = (top: number, withCountdown: boolean) => (
    <View style={[styles.floatStack, { top }]} pointerEvents="box-none">
      {demo ? (
        // Demo clips navigate through their own chrome — a stage leave chip would be a second,
        // dead back button. A spacer keeps the chips centered on the board.
        <View style={styles.floatSpacer} pointerEvents="none" />
      ) : (
        <Pressable
          style={({ pressed }) => [
            styles.leaveBtn,
            {
              backgroundColor: pressed ? tokens.surface2 : tokens.surface,
              borderColor: tokens.line,
              shadowColor: tokens.ink,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('leaveGame')}
          testID="stage-leave"
          onPress={onLeave}
        >
          <ArrowLeft size={20} color={tokens.ink} />
        </Pressable>
      )}
      <View style={styles.floatChips} pointerEvents="box-none">
        {spectatorBanner}
        {/* "Your turn" is wrong for a passive clip — the demo performs every move itself. */}
        {!demo && turnBanner}
        {eventPhaseBar}
        {withCountdown && <TurnCountdown floating />}
      </View>
      {/* Mirror of the leave chip's footprint, so the chips center on the board. */}
      <View style={styles.floatSpacer} pointerEvents="none" />
    </View>
  );

  const overlays = (
    <>
      {flow.claim && (
        <PaymentModal
          title={
            flow.claim.kind === 'route'
              ? t('claimRoute')
              : flow.claim.kind === 'station'
                ? t('buildStation')
                : flow.claim.broken
                  ? t('events.repairBrokenRail')
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
    // A bottom dock replaces rail/comms wholesale: a boarding-pass tray under a truly full-bleed
    // board — the status chips float OVER the board's top instead of consuming its height. The
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
      <View style={[styles.fill, { backgroundColor: tokens.paper }]}>
        <View style={styles.fill}>
          {board}
          {floatHud(insets.top + 6, true)}
        </View>
        <Animated.View
          // The dock is the only always-mounted HUD surface on phones (its panels swap by tab).
          // Registering it as a flight anchor gives card draws a destination even while the Hand
          // tab is inactive — otherwise the flight has no `hand` target and silently no-ops.
          ref={(v: View | null) => registerAnimTarget('dock', v)}
          collapsable={false}
          style={[
            styles.dock,
            {
              backgroundColor: tokens.paper,
              borderColor: tokens.line,
              shadowColor: tokens.ink,
            },
            dockAnimStyle,
            { paddingBottom: insets.bottom },
          ]}
        >
          {needKeep ? (
            <ScrollView contentContainerStyle={styles.dockPanel}>{chooser}</ScrollView>
          ) : (
            <>
              {/* The header (grab handle + tab bar) is the swipe surface: drag it to pull the
                  dock open or closed; the handle keeps working as a plain tap toggle. */}
              <GestureDetector gesture={dockPan}>
                <View
                  collapsable={false}
                  onLayout={(e) => setDockHeaderH(Math.round(e.nativeEvent.layout.height))}
                >
                  <Pressable
                    style={styles.handleRow}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t(dockCollapsed ? 'dockExpand' : 'dockCollapse')}
                    onPress={() => {
                      if (dragJustEnded()) return;
                      setDockCollapsed((c) => !c);
                    }}
                  >
                    <View style={[styles.handle, { backgroundColor: tokens.line }]} />
                  </Pressable>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.dockTabs}
                    contentContainerStyle={styles.dockTabsRow}
                  >
                    {tabs.map(({ key, labelKey, countSource }, tabIndex) => {
                      const count = countOf(countSource);
                      const active = dockTab === key;
                      const Icon = TAB_ICONS[key];
                      return (
                        <Pressable
                          key={key}
                          style={[
                            styles.dockTabBtn,
                            {
                              backgroundColor: active ? tokens.ember : tokens.surface2,
                              borderColor: active ? tokens.ember : tokens.line,
                            },
                          ]}
                          accessibilityRole="tab"
                          accessibilityState={{ selected: active }}
                          onPress={() => {
                            if (dragJustEnded()) return;
                            const from = tabs.findIndex((tb) => tb.key === dockTab);
                            if (tabIndex !== from) tabDir.value = tabIndex > from ? 1 : -1;
                            setDockTab(key);
                            // Tapping any tab while collapsed reopens the panel it names.
                            setDockCollapsed(false);
                          }}
                        >
                          <Icon size={14} color={active ? '#fff' : tokens.inkSoft} />
                          <Text
                            style={[
                              styles.dockTabText,
                              { color: active ? '#fff' : tokens.inkSoft },
                            ]}
                          >
                            {t(labelKey)}
                          </Text>
                          {count !== null && (
                            <View
                              style={[
                                styles.dockTabCount,
                                {
                                  backgroundColor: active
                                    ? 'rgba(255,255,255,0.28)'
                                    : rgba(tokens.ink, 0.08),
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.dockTabCountText,
                                  { color: active ? '#fff' : tokens.inkSoft },
                                ]}
                              >
                                {count}
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </GestureDetector>
              {/* Always mounted (clipped to ~0 height while collapsed) so the panel is already in
                  place as a drag reveals it; content swaps by tab under the fade/slide style. */}
              <Animated.View style={[styles.dockPanelWrap, tabAnimStyle]}>
                <ScrollView contentContainerStyle={styles.dockPanel}>
                  {dockTab === 'hand' ? (
                    handSection
                  ) : dockTab === 'draw' ? (
                    drawSection
                  ) : dockTab === 'missions' ? (
                    ticketsSection
                  ) : dockTab === 'events' ? (
                    <EventsPanel />
                  ) : dockTab === 'players' ? (
                    playersPanel(false)
                  ) : dockTab === 'log' ? (
                    logSection
                  ) : (
                    chatSection
                  )}
                </ScrollView>
              </Animated.View>
            </>
          )}
        </Animated.View>
        {overlays}
      </View>
    );
  }

  if (tier === 'three-pane') {
    return (
      <View style={[styles.fill, { backgroundColor: tokens.paper, paddingTop: insets.top }]}>
        <View style={styles.row}>
          <View style={styles.fill}>
            {board}
            {floatHud(8, false)}
          </View>
          <ScrollView
            style={[styles.rail, { borderLeftColor: tokens.line }]}
            contentContainerStyle={styles.railContent}
          >
            {railInner}
          </ScrollView>
          <View
            style={[
              styles.commsPane,
              { borderLeftColor: tokens.line, paddingBottom: insets.bottom },
            ]}
          >
            {logSection}
            {chatSection}
          </View>
        </View>
        {overlays}
      </View>
    );
  }

  // two-pane: board + rail, with a rail↔log↔comms tab set (ports the web narrow-desktop branch).
  return (
    <View style={[styles.fill, { backgroundColor: tokens.paper, paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.fill}>
          {board}
          {floatHud(8, false)}
        </View>
        <View style={[styles.rail, { borderLeftColor: tokens.line }]}>
          <View style={styles.commsTabs} accessibilityRole="tablist">
            {(sandbox ? (['rail', 'log'] as const) : (['rail', 'log', 'comms'] as const)).map(
              (key) => {
                const active = commsTab === key;
                return (
                  <Pressable
                    key={key}
                    style={[
                      styles.commsTabBtn,
                      {
                        backgroundColor: active ? tokens.ember : tokens.surface2,
                        borderColor: active ? tokens.ember : tokens.line,
                      },
                    ]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => setCommsTab(key)}
                  >
                    <Text style={[styles.dockTabText, { color: active ? '#fff' : tokens.inkSoft }]}>
                      {t(
                        key === 'rail' ? 'tabRail' : key === 'log' ? 'log.heading' : 'chat.heading',
                      )}
                    </Text>
                  </Pressable>
                );
              },
            )}
          </View>
          <ScrollView style={styles.fill} contentContainerStyle={styles.railContent}>
            {commsTab === 'rail' ? railInner : commsTab === 'log' ? logSection : chatSection}
          </ScrollView>
        </View>
      </View>
      {overlays}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  floatStack: {
    position: 'absolute',
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  floatChips: { flex: 1, alignItems: 'center', gap: 6 },
  floatSpacer: { width: 44 },
  leaveBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  spectatorBanner: {
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  spectatorText: { fontSize: 12 },
  spectatorStrong: { fontWeight: '700' },
  dock: {
    marginTop: -DOCK_OVERLAP,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
  },
  handleRow: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  handle: { width: 40, height: 4, borderRadius: 999 },
  dockTabs: { flexGrow: 0, flexShrink: 0 },
  dockTabsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 2,
    paddingBottom: 8,
  },
  dockTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    minHeight: 38,
    justifyContent: 'center',
  },
  dockTabText: { fontSize: 13, fontWeight: '600' },
  dockTabCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockTabCountText: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Fills whatever height the animated dock leaves under the header; the child ScrollView clips
  // its content to that (→ zero-height, invisible while collapsed).
  dockPanelWrap: { flex: 1 },
  dockPanel: { padding: 10, gap: 10 },
  rail: {
    width: RAIL_WIDTH,
    // Pinned: react-native-web's ScrollView base style adds flexGrow/Shrink 1, which would let
    // the rail eat the board's free space in a flex row (native defaults don't grow).
    flexGrow: 0,
    flexShrink: 0,
    borderLeftWidth: 1,
  },
  railContent: { padding: 10, gap: 10 },
  commsPane: {
    width: COMMS_WIDTH,
    borderLeftWidth: 1,
    padding: 10,
    gap: 10,
  },
  commsCard: { flex: 1, gap: 10 },
  commsTabs: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  commsTabBtn: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 8,
    alignItems: 'center',
    minHeight: 38,
    justifyContent: 'center',
  },
  marketBlock: { gap: 8 },
  drawTicketsBtn: {
    minHeight: 46,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  drawTicketsDisabled: { opacity: 0.45 },
  drawTicketsText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
