import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  TransformWrapper,
  TransformComponent,
  useControls,
  useTransformEffect,
} from 'react-zoom-pan-pinch';
import { Plus, Minus, LocateFixed, Maximize, Minimize, Eye, EyeOff } from 'lucide-react';
import type { GameSnapshot, GameEvent } from '@trm/proto';
import { CITIES, ROUTES, cityById, routeById, cityName, cityTier } from '../game/content';
import {
  closedRouteIds,
  reopenBonusRouteIds,
  skyLanternRouteIds,
  hotspotLevels,
} from '../game/events';
import { ROUTE_GEOMETRY, HUB_CITIES } from '../game/routeGeometry';
import { ownershipMap } from '../game/view';
import { zoomBucket } from '../game/lod';
import {
  transformToView,
  viewToTransform,
  boardProjection,
  visibleFraction,
  frameDurationMs,
  type BoardTransform,
} from '../game/boardView';
import { frameHome } from '../game/frameHome';
import { ACTIVE_BASE_VIEW, ACTIVE_GEOGRAPHY } from '../game/catalog';
import { MapScene } from './MapScene';
import { seatColor } from '../theme/colors';
import { useUi, type Locale } from '../store/ui';
import { useGame, useGameStore } from '../store/game';
import { useAnimationsStore } from '../store/animations';
import { getSocket } from '../net/connection';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { BoardFrameTarget } from '../game/boardView';

interface BoardProps {
  snapshot: GameSnapshot;
  locale: Locale;
  colorBlind: boolean;
  /** Gated independently so a tutorial `await` beat waiting on one action (claim a route / build a
   *  station) doesn't leave the OTHER category's affordance live on the map. */
  canClaim: boolean;
  canBuildStation: boolean;
  onPickRoute(routeId: string): void;
  onPickCity(cityId: string): void;
  /** Cities to softly highlight (the offered tickets' endpoints, while choosing tickets). */
  highlightCities?: ReadonlySet<string> | undefined;
  /** Sandbox (tutorial/encyclopedia): suppress the live camera broadcast + follow. */
  sandbox?: boolean | undefined;
  /** Tutorial auto-pan: frame these routes/cities. Null/undefined leaves the camera alone. */
  frameTarget?: BoardFrameTarget | null | undefined;
}

/**
 * Reflects the live zoom onto the viewport: `data-zoom` drives label/badge level-of-detail.
 * `--inv-scale` (≈ 1/scale) counter-scales the labels and track weight so they keep a roughly
 * constant on-screen size as the geography zooms (instead of ballooning, Google-Maps style).
 * `--marker-scale` is the opposite: station markers GROW with zoom — but gently (≈ √zoom on
 * screen) and clamped, so they pop as you zoom in without swallowing the corridor or vanishing
 * when zoomed out. The land, coastline, and relief are not scaled either way, so the island grows.
 */
function ZoomTracker({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  useTransformEffect((ref) => {
    const el = targetRef.current;
    if (!el) return;
    const s = ref.state.scale;
    el.dataset.zoom = zoomBucket(s);
    el.style.setProperty('--inv-scale', String(Math.max(0.12, Math.min(1.5, 1 / s))));
    el.style.setProperty(
      '--marker-scale',
      String(Math.max(0.34, Math.min(0.82, 1 / Math.sqrt(s)))),
    );
  });
  return null;
}

/** Board units spanned when auto-framing a bot's action POI (a comfortable close-up). */
const BOT_FOLLOW_SPAN = 34;

/** A claimed route glows for this long once it actually comes into view. */
const GLOW_MS = 1300;
/** Drop an armed glow that never reaches half-visibility within this window (claim never seen). */
const GLOW_WAIT_MS = 2600;
/** The glow fires once at least this fraction of the route's cars sit inside the viewport. */
const GLOW_VISIBLE_FRACTION = 0.5;

/**
 * Turn the follow toggle off in response to a manual gesture — UNLESS it's the local player's
 * own turn. During my turn the camera I'm panning/zooming is my OWN board view (it's even being
 * broadcast to followers), so a gesture must not cancel follow; it stays armed and resumes on the
 * next player once my turn lapses. On any other player's turn a gesture takes the camera back.
 */
const disengageFollow = (): void => {
  const ui = useUi.getState();
  if (!ui.followActing) return;
  const snap = useGame.getState().snapshot;
  const myTurn = !!snap?.you?.playerId && snap.currentPlayerId === snap.you.playerId;
  if (myTurn) return;
  ui.setFollowActing(false);
};

/** The live board→pixel projection read off the rendered <svg.board> within this viewport. */
const viewportProjection = (viewportEl: HTMLDivElement | null) =>
  boardProjection(viewportEl?.querySelector<SVGSVGElement>('svg.board'));

/**
 * Board coordinate (+ a stable key) of `playerId`'s most recent spatial action in the event tail.
 * Scoped to that player so following a bot glides only to ITS moves — never to a stale action from
 * the previous turn (which matters now that follow can stay armed through the viewer's own turn).
 */
function latestActionPoi(
  events: readonly GameEvent[],
  playerId: string,
): { x: number; y: number; key: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]?.event;
    if (!e) continue;
    if (e.case === 'routeClaimed' || e.case === 'tunnelRevealed') {
      if (e.value.playerId !== playerId) continue;
      const g = ROUTE_GEOMETRY.get(e.value.routeId);
      if (g) return { x: g.mid.x, y: g.mid.y, key: `${e.case}:${e.value.routeId}:${i}` };
    } else if (e.case === 'stationBuilt') {
      if (e.value.playerId !== playerId) continue;
      const c = cityById.get(e.value.cityId);
      if (c) return { x: c.x, y: c.y, key: `station:${e.value.cityId}:${i}` };
    }
  }
  return null;
}

/**
 * "Follow the acting player": a headless child of the pan/zoom context that, when armed,
 * drives the local camera. While it is MY turn it broadcasts my framing (board-space, so it
 * survives any window size) at ≈12 Hz; while another HUMAN acts it mirrors their relayed
 * framing; while a BOT acts — which has no camera — it glides to the POI of each action the
 * bot takes. A manual gesture disarms the toggle elsewhere, so this never fights the user.
 */
function CameraSync({
  snapshot,
  viewportRef,
}: {
  snapshot: GameSnapshot;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const { setTransform } = useControls();
  const followActing = useUi((s) => s.followActing);
  const actingCamera = useGameStore((s) => s.actingCamera);
  const recentEvents = useGameStore((s) => s.recentEvents);

  const me = snapshot.you?.playerId ?? null;
  const current = snapshot.currentPlayerId;
  const myTurn = !!me && current === me;
  const currentIsBot = current.startsWith('bot:');

  // Mirror the live transform into a ref so the broadcast timer can sample it cheaply.
  const liveRef = useRef<BoardTransform>({ positionX: 0, positionY: 0, scale: 1 });
  useTransformEffect((ref) => {
    liveRef.current = {
      positionX: ref.state.positionX,
      positionY: ref.state.positionY,
      scale: ref.state.scale,
    };
  });

  // ── Broadcast my framing while it's my turn (≈12 Hz, and only when it actually moves) ──
  useEffect(() => {
    if (!myTurn) return;
    let last: { cx: number; cy: number; span: number } | null = null;
    const tick = (): void => {
      const socket = getSocket();
      const w = viewportRef.current?.clientWidth ?? 0;
      const h = viewportRef.current?.clientHeight ?? 0;
      const proj = viewportProjection(viewportRef.current);
      if (!socket || !proj || w <= 0 || h <= 0) return;
      const view = transformToView(liveRef.current, proj, w, h);
      if (
        last &&
        Math.abs(last.cx - view.cx) < 0.05 &&
        Math.abs(last.cy - view.cy) < 0.05 &&
        Math.abs(last.span - view.span) < 0.05
      )
        return;
      last = view;
      socket.cameraUpdate(view);
    };
    tick(); // one frame immediately so a follower sees where I start
    const id = setInterval(tick, 80);
    return () => clearInterval(id);
  }, [myTurn, viewportRef]);

  // ── Follow a HUMAN actor: mirror their relayed framing as it streams in ──
  useEffect(() => {
    if (!followActing || myTurn || currentIsBot) return;
    if (!actingCamera || actingCamera.playerId !== current) return;
    const w = viewportRef.current?.clientWidth ?? 0;
    const h = viewportRef.current?.clientHeight ?? 0;
    const proj = viewportProjection(viewportRef.current);
    if (!proj || w <= 0 || h <= 0) return;
    const t = viewToTransform(actingCamera.view, proj, w, h);
    setTransform(t.positionX, t.positionY, t.scale, 150, 'easeOut');
  }, [followActing, myTurn, currentIsBot, current, actingCamera, setTransform, viewportRef]);

  // ── Follow a BOT actor: glide to the POI of each NEW spatial action ──
  const lastPoiKey = useRef<string | null>(null);
  useEffect(() => {
    if (!followActing || myTurn || !currentIsBot) {
      lastPoiKey.current = null;
      return;
    }
    const poi = latestActionPoi(recentEvents, current);
    if (!poi || poi.key === lastPoiKey.current) return;
    const w = viewportRef.current?.clientWidth ?? 0;
    const h = viewportRef.current?.clientHeight ?? 0;
    const proj = viewportProjection(viewportRef.current);
    if (!proj || w <= 0 || h <= 0) return;
    lastPoiKey.current = poi.key;
    const t = viewToTransform({ cx: poi.x, cy: poi.y, span: BOT_FOLLOW_SPAN }, proj, w, h);
    setTransform(t.positionX, t.positionY, t.scale, 600, 'easeOut');
  }, [followActing, myTurn, currentIsBot, current, recentEvents, setTransform, viewportRef]);

  return null;
}

/**
 * Gates the route-claim glow on visibility. A freshly-claimed route is "armed" the instant the
 * event lands, but its glow only STARTS once at least half its cars are within the viewport — so
 * when the follow-camera is mid-pan toward a bot's claim the highlight waits for the railway to
 * arrive on screen rather than flashing while it's still off in the corner. Lives inside the
 * pan/zoom context so it can re-test on every transform frame of the glide; `onStart` hands the
 * promotion back to the Board, which owns the glow's expiry timers.
 */
function RouteGlowGate({
  armed,
  started,
  onStart,
  viewportRef,
}: {
  armed: Map<string, number>;
  started: Map<string, number>;
  onStart: (routeId: string, seat: number) => void;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const live = useRef<BoardTransform>({ positionX: 0, positionY: 0, scale: 1 });
  const startedRef = useRef(started);
  startedRef.current = started;

  // Held in a ref so both the transform effect and the armed-change effect call the same closure
  // without either needing the other's deps.
  const evaluate = useRef<() => void>(() => {});
  evaluate.current = (): void => {
    if (armed.size === 0) return;
    const w = viewportRef.current?.clientWidth ?? 0;
    const h = viewportRef.current?.clientHeight ?? 0;
    const proj = viewportProjection(viewportRef.current);
    if (!proj || w <= 0 || h <= 0) return;
    for (const [routeId, seat] of armed) {
      if (startedRef.current.has(routeId)) continue;
      const g = ROUTE_GEOMETRY.get(routeId);
      // No geometry to test → start it immediately; otherwise wait until it's half in view.
      if (!g || visibleFraction(g.slots, live.current, proj, w, h) >= GLOW_VISIBLE_FRACTION) {
        onStart(routeId, seat);
      }
    }
  };

  // Re-check on every transform frame, so a follow-pan promotes the route as it slides into view…
  useTransformEffect((ref) => {
    live.current = {
      positionX: ref.state.positionX,
      positionY: ref.state.positionY,
      scale: ref.state.scale,
    };
    evaluate.current();
  });
  // …and whenever the armed set changes (a claim made while the route is already on screen).
  useEffect(() => {
    evaluate.current();
  }, [armed]);

  return null;
}

/**
 * Frames the board on the longest-trail route reveal (triggered from the final scoreboard) so the
 * highlighted path is brought into view. Lives inside the pan/zoom context for `setTransform`; it
 * re-fits whenever the revealed path changes and is otherwise inert.
 */
function RevealFramer({ viewportRef }: { viewportRef: RefObject<HTMLDivElement | null> }) {
  const { setTransform } = useControls();
  const reveal = useAnimationsStore((s) => s.routeReveal);
  useEffect(() => {
    if (!reveal || reveal.path.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const rid of reveal.path) {
      const r = routeById.get(rid);
      if (!r) continue;
      for (const cid of [r.a as string, r.b as string]) {
        const c = cityById.get(cid);
        if (!c) continue;
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y);
        maxY = Math.max(maxY, c.y);
      }
    }
    if (!Number.isFinite(minX)) return;
    const w = viewportRef.current?.clientWidth ?? 0;
    const h = viewportRef.current?.clientHeight ?? 0;
    const proj = viewportProjection(viewportRef.current);
    if (!proj || w <= 0 || h <= 0) return;
    const span = Math.min(100, Math.max(22, Math.max(maxX - minX, maxY - minY) + 16));
    const t = viewToTransform({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span }, proj, w, h);
    setTransform(t.positionX, t.positionY, t.scale, 500, 'easeOut');
  }, [reveal, setTransform, viewportRef]);
  return null;
}

/**
 * Auto-pan framer: frames the board on a set of routes/cities. Driven by the tutorial/replay
 * `frameTarget` prop when present (sandbox contexts); otherwise falls back to the live game's
 * `eventSpotlight` store field (set from the events panel's affected-routes list). Lives inside the
 * pan/zoom context for `setTransform`; re-fits whenever the effective target changes, inert otherwise.
 */
function SpotlightFramer({
  viewportRef,
  target,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  target: BoardFrameTarget | null | undefined;
}) {
  const { setTransform } = useControls();
  const reduced = useReducedMotion();
  const eventSpotlight = useAnimationsStore((s) => s.eventSpotlight);
  const effective = target ?? eventSpotlight;
  const key = effective ? `${effective.kind}:${effective.ids.join(',')}` : '';
  useEffect(() => {
    if (!effective || effective.ids.length === 0) return;
    const cityIds =
      effective.kind === 'route'
        ? effective.ids.flatMap((rid) => {
            const r = routeById.get(rid);
            return r ? [r.a as string, r.b as string] : [];
          })
        : effective.ids;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cid of cityIds) {
      const c = cityById.get(cid);
      if (!c) continue;
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    if (!Number.isFinite(minX)) return;
    const w = viewportRef.current?.clientWidth ?? 0;
    const h = viewportRef.current?.clientHeight ?? 0;
    const proj = viewportProjection(viewportRef.current);
    if (!proj || w <= 0 || h <= 0) return;
    const span = Math.min(100, Math.max(22, Math.max(maxX - minX, maxY - minY) + 16));
    const t = viewToTransform({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span }, proj, w, h);
    setTransform(t.positionX, t.positionY, t.scale, frameDurationMs(effective, reduced), 'easeOut');
  }, [key, effective, reduced]);
  return null;
}

/**
 * Zoom controls wired to the pan/zoom context, plus reset (re-centre) and a real
 * fullscreen toggle that drives the Fullscreen API on the board viewport.
 */
function MapControls({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const controls = useControls();
  const { zoomIn, zoomOut } = controls;
  const followActing = useUi((s) => s.followActing);
  const setFollowActing = useUi((s) => s.setFollowActing);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Track fullscreen via the platform event so the icon/label stay correct even when the
  // user exits with Esc or the OS chrome rather than our button.
  useEffect(() => {
    const sync = (): void => setIsFullscreen(document.fullscreenElement === targetRef.current);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [targetRef]);

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
      return;
    }
    const req = targetRef.current?.requestFullscreen?.();
    if (req) void req.catch(() => undefined); // denied (e.g. no user gesture) — stay windowed
  };

  return (
    <div className="map-controls">
      <button
        type="button"
        className="follow-toggle"
        aria-label={t(followActing ? 'stopFollowing' : 'followView')}
        aria-pressed={followActing}
        title={t(followActing ? 'stopFollowing' : 'followView')}
        onClick={() => setFollowActing(!followActing)}
      >
        {followActing ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
      </button>
      <button
        type="button"
        aria-label={t('zoomIn')}
        onClick={() => {
          disengageFollow();
          zoomIn();
        }}
      >
        <Plus size={16} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t('zoomOut')}
        onClick={() => {
          disengageFollow();
          zoomOut();
        }}
      >
        <Minus size={16} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t('resetView')}
        onClick={() => {
          disengageFollow();
          frameHome(controls, 200);
        }}
      >
        <LocateFixed size={15} aria-hidden />
      </button>
      {/* iPhone Safari has no element Fullscreen API — don't render a dead button there. */}
      {document.fullscreenEnabled && (
        <button
          type="button"
          aria-label={t(isFullscreen ? 'exitFullscreen' : 'fullscreen')}
          aria-pressed={isFullscreen}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize size={15} aria-hidden /> : <Maximize size={15} aria-hidden />}
        </button>
      )}
    </div>
  );
}

export function Board({
  snapshot,
  locale,
  colorBlind,
  canClaim,
  canBuildStation,
  onPickRoute,
  onPickCity,
  highlightCities,
  sandbox,
  frameTarget,
}: BoardProps) {
  const owned = useMemo(() => ownershipMap(snapshot), [snapshot]);
  const stationCities = useMemo(() => {
    const seats = new Map(snapshot.players.map((p) => [p.id, p.seat]));
    return new Map(snapshot.stations.map((s) => [s.cityId, seats.get(s.playerId) ?? 0]));
  }, [snapshot]);
  // Random-events overlays — all derived purely from the authoritative `random_events` projection.
  const closedRoutes = useMemo(() => closedRouteIds(snapshot.randomEvents), [snapshot]);
  const reopenRoutes = useMemo(() => reopenBonusRouteIds(snapshot.randomEvents), [snapshot]);
  const skyRoutes = useMemo(() => skyLanternRouteIds(snapshot.randomEvents), [snapshot]);
  const hotspots = useMemo(() => hotspotLevels(snapshot.randomEvents), [snapshot]);
  const charterCities = useMemo(() => {
    const set = new Set<string>();
    const rev = snapshot.randomEvents;
    if (rev)
      for (const c of rev.charters)
        if (c.wonByPlayerId === '') {
          set.add(c.cityA);
          set.add(c.cityB);
        }
    return set;
  }, [snapshot]);
  const lanternCity = snapshot.randomEvents?.lanternHost?.cityId ?? null;
  const procession = useMemo(
    () => snapshot.randomEvents?.active.find((event) => event.kind === 'GODDESS_PROCESSION'),
    [snapshot],
  );
  const processionPath = procession?.cityPath ?? [];
  const processionCity =
    processionPath[Math.min(procession?.position ?? 0, Math.max(0, processionPath.length - 1))] ??
    null;
  const bentoCities = useMemo(
    () =>
      new Set(
        snapshot.randomEvents?.active
          .filter((event) => event.kind === 'BENTO_RUSH' && event.cityId)
          .map((event) => event.cityId) ?? [],
      ),
    [snapshot],
  );
  const nightMarketCities = useMemo(
    () =>
      new Set(
        snapshot.randomEvents?.active
          .filter((event) => event.kind === 'STATION_FRONT_NIGHT_MARKET' && event.cityId)
          .map((event) => event.cityId) ?? [],
      ),
    [snapshot],
  );
  const harvestRoutes = useMemo(
    () =>
      new Set(
        snapshot.randomEvents?.active
          .filter((event) => event.kind === 'HARVEST_FESTIVAL_EXPRESS')
          .flatMap((event) => event.routeIds) ?? [],
      ),
    [snapshot],
  );
  const luckyCities = useMemo(() => {
    const set = new Set<string>();
    for (const contract of snapshot.randomEvents?.luckyContracts ?? []) {
      if (contract.wonByPlayerId !== '') continue;
      set.add(contract.cityA);
      set.add(contract.cityB);
    }
    return set;
  }, [snapshot]);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Transient claim/station glow + the ticket-completion path sweep (cleared on a timer).
  // `armedGlowRoutes` = claimed-but-not-yet-shown (the store); `startedGlowRoutes` = glow actually
  // running (promoted by RouteGlowGate once the railway is ≥50% in view). The class reads the latter.
  const armedGlowRoutes = useAnimationsStore((s) => s.glowingRoutes);
  const glowingStations = useAnimationsStore((s) => s.glowingStations);
  const sweeps = useAnimationsStore((s) => s.sweeps);
  const routeReveal = useAnimationsStore((s) => s.routeReveal);
  const clearGlowRoute = useAnimationsStore((s) => s.clearGlowRoute);
  const clearGlowStation = useAnimationsStore((s) => s.clearGlowStation);
  const removeSweep = useAnimationsStore((s) => s.removeSweep);

  const [startedGlowRoutes, setStartedGlowRoutes] = useState<Map<string, number>>(new Map());
  const startedGlowRef = useRef(startedGlowRoutes);
  startedGlowRef.current = startedGlowRoutes;
  const startGlow = useCallback((routeId: string, seat: number) => {
    setStartedGlowRoutes((m) => (m.has(routeId) ? m : new Map(m).set(routeId, seat)));
  }, []);

  // Once a route's glow STARTS (it came into view), run it for GLOW_MS then clear local + store.
  // Each route schedules exactly one clear (guarded by the ref) so a re-render never resets it.
  const glowClearTimers = useRef(new Map<string, number>());
  useEffect(() => {
    for (const id of startedGlowRoutes.keys()) {
      if (glowClearTimers.current.has(id)) continue;
      const tid = window.setTimeout(() => {
        glowClearTimers.current.delete(id);
        setStartedGlowRoutes((m) => {
          if (!m.has(id)) return m;
          const n = new Map(m);
          n.delete(id);
          return n;
        });
        clearGlowRoute(id);
      }, GLOW_MS);
      glowClearTimers.current.set(id, tid);
    }
  }, [startedGlowRoutes, clearGlowRoute]);

  // An armed route that never reaches half-visibility within the grace window (e.g. a bot's claim
  // while not following) is dropped unseen, so it neither glows late nor piles up in the store.
  const glowWaitTimers = useRef(new Map<string, number>());
  useEffect(() => {
    for (const id of armedGlowRoutes.keys()) {
      if (glowWaitTimers.current.has(id)) continue;
      const tid = window.setTimeout(() => {
        glowWaitTimers.current.delete(id);
        if (!startedGlowRef.current.has(id)) clearGlowRoute(id);
      }, GLOW_WAIT_MS);
      glowWaitTimers.current.set(id, tid);
    }
    for (const id of [...glowWaitTimers.current.keys()]) {
      if (!armedGlowRoutes.has(id)) {
        clearTimeout(glowWaitTimers.current.get(id));
        glowWaitTimers.current.delete(id);
      }
    }
  }, [armedGlowRoutes, clearGlowRoute]);

  // Tidy any still-pending glow timers on unmount.
  useEffect(
    () => () => {
      for (const tid of glowClearTimers.current.values()) clearTimeout(tid);
      for (const tid of glowWaitTimers.current.values()) clearTimeout(tid);
    },
    [],
  );

  useEffect(() => {
    if (glowingStations.size === 0) return;
    const timers = [...glowingStations.keys()].map((id) =>
      window.setTimeout(() => clearGlowStation(id), 1100),
    );
    return () => timers.forEach(clearTimeout);
  }, [glowingStations, clearGlowStation]);
  useEffect(() => {
    if (sweeps.length === 0) return;
    const timers = sweeps.map((sw) =>
      window.setTimeout(() => removeSweep(sw.id), sw.path.length * 320 + 900),
    );
    return () => timers.forEach(clearTimeout);
  }, [sweeps, removeSweep]);

  // data-zoom seeds at the framed home tier (`local`) to avoid a first-paint label flash before
  // ZoomTracker takes over.
  return (
    <div
      className="board-viewport"
      data-zoom="local"
      ref={viewportRef}
      onDoubleClick={disengageFollow}
    >
      <TransformWrapper
        minScale={0.8}
        maxScale={8}
        initialScale={1.9}
        centerOnInit
        // Frame the island to the real viewport once measured (same as the reset button), so first
        // paint is the proper home view on any window shape rather than the fixed 1.9 seed.
        onInit={(ref) => frameHome(ref, 0)}
        wheel={{ step: 0.0022 }}
        doubleClick={{ mode: 'zoomIn', step: 0.6 }}
        panning={{ velocityDisabled: true }}
        // A real user gesture takes back the camera: it disarms "follow" so we never fight them.
        // These fire only on input, not on our own setTransform, so following never disarms itself.
        onPanningStart={disengageFollow}
        onWheelStart={disengageFollow}
        onPinchStart={disengageFollow}
      >
        <ZoomTracker targetRef={viewportRef} />
        {!sandbox && <CameraSync snapshot={snapshot} viewportRef={viewportRef} />}
        <RevealFramer viewportRef={viewportRef} />
        <SpotlightFramer viewportRef={viewportRef} target={frameTarget ?? null} />
        <RouteGlowGate
          armed={armedGlowRoutes}
          started={startedGlowRoutes}
          onStart={startGlow}
          viewportRef={viewportRef}
        />
        <MapControls targetRef={viewportRef} />
        <TransformComponent
          wrapperClass="board-transform"
          contentClass="board-content"
          wrapperStyle={{ width: '100%', height: '100%' }}
        >
          <MapScene
            cities={CITIES}
            routes={ROUTES}
            geometry={ROUTE_GEOMETRY}
            hubs={HUB_CITIES}
            geography={ACTIVE_GEOGRAPHY ?? undefined}
            view={ACTIVE_BASE_VIEW}
            owned={owned}
            stations={stationCities}
            glowingRoutes={startedGlowRoutes}
            glowingStations={glowingStations}
            highlightCities={highlightCities}
            canClaim={canClaim}
            canBuildStation={canBuildStation}
            colorBlind={colorBlind}
            cityLabel={(c) => cityName(c.id, locale)}
            cityTier={cityTier}
            routeTitle={(r) => `${cityName(r.a, locale)}–${cityName(r.b, locale)} · ${r.length}`}
            // A typhoon-closed route can't be claimed (the server rejects it), so it's not
            // clickable here either — the overlay signals why.
            claimFilter={(r) => !closedRoutes.has(r.id)}
            routeClass={(r) =>
              [
                closedRoutes.has(r.id) ? 'evt-closed' : '',
                skyRoutes.has(r.id) ? 'evt-sky' : '',
                reopenRoutes.has(r.id) ? 'evt-reopen' : '',
                harvestRoutes.has(r.id) ? 'evt-harvest' : '',
              ]
                .filter(Boolean)
                .join(' ')
            }
            routeData={(r) => ({
              'data-closed': closedRoutes.has(r.id) ? 'true' : undefined,
              'data-sky': skyRoutes.has(r.id) ? 'true' : undefined,
              'data-reopen': reopenRoutes.has(r.id) ? 'true' : undefined,
              'data-harvest': harvestRoutes.has(r.id) ? 'true' : undefined,
            })}
            cityData={(c) => {
              const hotspot = hotspots.get(c.id);
              return {
                'data-hotspot': hotspot !== undefined ? String(hotspot) : undefined,
                'data-charter': charterCities.has(c.id) ? 'true' : undefined,
                'data-lantern-host': lanternCity === c.id ? 'true' : undefined,
                'data-procession': processionPath.includes(c.id) ? 'trail' : undefined,
                'data-procession-current': processionCity === c.id ? 'true' : undefined,
                'data-bento': bentoCities.has(c.id) ? 'true' : undefined,
                'data-night-market': nightMarketCities.has(c.id) ? 'true' : undefined,
                'data-lucky': luckyCities.has(c.id) ? 'true' : undefined,
              };
            }}
            renderRouteOverlay={(r, g) => (
              <>
                {/* Typhoon closure: a swirl glyph over a desaturated route (see CSS .route.evt-closed). */}
                {closedRoutes.has(r.id) && (
                  <g className="evt-typhoon" pointerEvents="none" aria-hidden>
                    <circle className="evt-badge-bg" cx={g.mid.x} cy={g.mid.y} />
                    <text className="evt-typhoon-glyph" x={g.mid.x} y={g.mid.y}>
                      🌀
                    </text>
                  </g>
                )}
                {/* Reopened route: a subtle +2 first-claim bonus chip. */}
                {reopenRoutes.has(r.id) && !owned.get(r.id) && (
                  <g className="evt-chip evt-reopen-chip" pointerEvents="none" aria-hidden>
                    <circle cx={g.mid.x} cy={g.mid.y} />
                    <text x={g.mid.x} y={g.mid.y}>
                      +2
                    </text>
                  </g>
                )}
              </>
            )}
            renderCityOverlay={(c) => {
              const hotspot = hotspots.get(c.id);
              return (
                <>
                  {/* Permanent/open expansion races and moving city markers. */}
                  {luckyCities.has(c.id) && (
                    <circle
                      className="evt-lucky-chip"
                      cx={c.x}
                      cy={c.y}
                      pointerEvents="none"
                      aria-hidden
                    />
                  )}
                  {lanternCity === c.id && (
                    <g className="evt-city-badge evt-lantern-host" pointerEvents="none" aria-hidden>
                      <circle cx={c.x - 2.4} cy={c.y - 2.4} />
                      <text x={c.x - 2.4} y={c.y - 2.4}>
                        +6
                      </text>
                    </g>
                  )}
                  {processionCity === c.id && (
                    <g className="evt-city-badge evt-procession" pointerEvents="none" aria-hidden>
                      <circle cx={c.x + 2.4} cy={c.y - 2.4} />
                      <text x={c.x + 2.4} y={c.y - 2.4}>
                        P
                      </text>
                    </g>
                  )}
                  {bentoCities.has(c.id) && (
                    <g className="evt-city-badge evt-bento" pointerEvents="none" aria-hidden>
                      <circle cx={c.x - 2.4} cy={c.y + 2.4} />
                      <text x={c.x - 2.4} y={c.y + 2.4}>
                        B
                      </text>
                    </g>
                  )}
                  {nightMarketCities.has(c.id) && (
                    <g className="evt-city-badge evt-night-market" pointerEvents="none" aria-hidden>
                      <circle cx={c.x + 2.4} cy={c.y + 2.4} />
                      <text x={c.x + 2.4} y={c.y + 2.4}>
                        N
                      </text>
                    </g>
                  )}
                  {/* Charter endpoint: a small contract chip behind the marker. */}
                  {charterCities.has(c.id) && (
                    <circle
                      className="evt-charter-chip"
                      cx={c.x}
                      cy={c.y}
                      pointerEvents="none"
                      aria-hidden
                    />
                  )}
                  {/* Viral hotspot: a +1/+2 badge above the station. */}
                  {hotspot !== undefined && (
                    <g className="evt-hotspot" pointerEvents="none" aria-hidden>
                      <circle className="evt-badge-bg" cx={c.x + 2.2} cy={c.y - 2.2} />
                      <text className="evt-hotspot-text" x={c.x + 2.2} y={c.y - 2.2}>
                        +{hotspot}
                      </text>
                    </g>
                  )}
                </>
              );
            }}
            onRouteClick={onPickRoute}
            onCityClick={onPickCity}
            ariaLabel="Taiwan railway map"
          >
            {processionPath.length > 1 && (
              <polyline
                className="evt-procession-trail"
                data-testid="procession-trail"
                points={processionPath
                  .map((id) => cityById.get(id))
                  .filter((city) => city !== undefined)
                  .map((city) => `${city.x},${city.y}`)
                  .join(' ')}
                pointerEvents="none"
                aria-hidden
              />
            )}

            {snapshot.randomEvents?.luckyContracts
              .filter((contract) => contract.wonByPlayerId === '')
              .map((contract) => {
                const a = cityById.get(contract.cityA);
                const b = cityById.get(contract.cityB);
                if (!a || !b) return null;
                return (
                  <line
                    key={contract.eventId}
                    className="evt-lucky-link"
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    pointerEvents="none"
                    aria-hidden
                  />
                );
              })}

            {/* Ticket-completion sweep: seat-colour glow drawn start→end along the owned path. */}
            {sweeps.map((sw) => (
              <g key={sw.id} className="sweep-layer" pointerEvents="none">
                {sw.path.map((rid, i) => {
                  const sg = ROUTE_GEOMETRY.get(rid);
                  if (!sg) return null;
                  return (
                    <path
                      key={i}
                      className="sweep-seg"
                      d={sg.path}
                      pathLength={1}
                      style={
                        { '--seat': seatColor(sw.seat), '--delay': `${i * 0.32}s` } as CSSProperties
                      }
                    />
                  );
                })}
              </g>
            ))}

            {/* Longest-trail review: a persistent seat-colour sweep along the player's longest route. */}
            {routeReveal && (
              <g className="sweep-layer reveal-layer" pointerEvents="none">
                {routeReveal.path.map((rid, i) => {
                  const sg = ROUTE_GEOMETRY.get(rid);
                  if (!sg) return null;
                  return (
                    <path
                      key={rid}
                      className="sweep-seg"
                      d={sg.path}
                      pathLength={1}
                      style={
                        {
                          '--seat': seatColor(routeReveal.seat),
                          '--delay': `${i * 0.12}s`,
                        } as CSSProperties
                      }
                    />
                  );
                })}
              </g>
            )}
          </MapScene>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
