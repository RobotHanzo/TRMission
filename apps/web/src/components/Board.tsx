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
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { Plus, Minus, LocateFixed, Maximize, Minimize, Eye, EyeOff } from 'lucide-react';
import type { GameSnapshot, GameEvent } from '@trm/proto';
import type { RouteColor } from '@trm/shared';
import { CITIES, ROUTES, cityById, routeById, cityName } from '../game/content';
import { ROUTE_GEOMETRY, HUB_CITIES } from '../game/routeGeometry';
import { ownershipMap } from '../game/view';
import { zoomBucket, cityTier } from '../game/lod';
import {
  transformToView,
  viewToTransform,
  boardProjection,
  visibleFraction,
  type BoardTransform,
} from '../game/boardView';
import { BASE_VIEW, fitTransform } from '../game/geography';
import { Geography } from './Geography';
import { CARD_COLOR_TOKENS, GRAY_TOKEN, SEAT_COLORS, LIVERY_COLORS } from '../theme/colors';
import { useUi, type Locale } from '../store/ui';
import { useGame } from '../store/game';
import { useAnimations } from '../store/animations';
import { getSocket } from '../net/connection';

const seatColor = (seat: number): string => SEAT_COLORS[seat % 5] ?? '#888';

interface BoardProps {
  snapshot: GameSnapshot;
  locale: Locale;
  colorBlind: boolean;
  canAct: boolean;
  onPickRoute(routeId: string): void;
  onPickCity(cityId: string): void;
  /** Cities to softly highlight (the offered tickets' endpoints, while choosing tickets). */
  highlightCities?: ReadonlySet<string> | undefined;
}

const VIEWBOX = `${BASE_VIEW.x} ${BASE_VIEW.y} ${BASE_VIEW.w} ${BASE_VIEW.h}`;

const colorOf = (rc: RouteColor): string =>
  rc === 'GRAY' ? GRAY_TOKEN.hex : CARD_COLOR_TOKENS[rc].hex;
const glyphOf = (rc: RouteColor): string =>
  rc === 'GRAY' ? GRAY_TOKEN.glyph : CARD_COLOR_TOKENS[rc].glyph;

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

/**
 * The home/reset view: frame the Taiwan silhouette (`path.land`) to the live viewport and centre
 * it. The pan/zoom content sizes to the SVG's intrinsic box (not the viewport), so the island's
 * on-screen size can't be modelled from the viewport alone — we measure the rendered land box and
 * the current transform, recover the island's content-space rect, and fit that. This holds at any
 * window shape, and replaces the old fixed scale that left the island tiny on wide boards.
 */
function frameHome(ref: ReactZoomPanPinchContentRef, animationTime: number): void {
  const { instance, setTransform } = ref;
  const wrap = instance.wrapperComponent;
  const content = instance.contentComponent;
  const land = content?.querySelector<SVGPathElement>('path.land');
  if (!wrap || !content || !land || typeof DOMMatrix === 'undefined') return; // needs a real DOM
  const wr = wrap.getBoundingClientRect();
  const lr = land.getBoundingClientRect();
  if (!wr.width || !wr.height || !lr.width || !lr.height) return; // not laid out yet (e.g. jsdom)
  // Read the live transform straight off the DOM so it's consistent with the measured rect —
  // `instance.state` can still lag `centerOnInit` at onInit time, which would skew the centring.
  const css = getComputedStyle(content).transform;
  const m = css && css !== 'none' ? new DOMMatrix(css) : new DOMMatrix();
  const scale = m.a;
  if (!scale) return;
  // Un-apply that transform to recover the island's rect in the content's own pixel space.
  const target = {
    cx: (lr.left + lr.width / 2 - wr.left - m.e) / scale,
    cy: (lr.top + lr.height / 2 - wr.top - m.f) / scale,
    w: lr.width / scale,
    h: lr.height / scale,
  };
  const t = fitTransform(target, { w: wr.width, h: wr.height });
  setTransform(t.x, t.y, t.scale, animationTime, 'easeOut');
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
  const actingCamera = useGame((s) => s.actingCamera);
  const recentEvents = useGame((s) => s.recentEvents);

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
  const reveal = useAnimations((s) => s.routeReveal);
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
      <button
        type="button"
        aria-label={t(isFullscreen ? 'exitFullscreen' : 'fullscreen')}
        aria-pressed={isFullscreen}
        onClick={toggleFullscreen}
      >
        {isFullscreen ? <Minimize size={15} aria-hidden /> : <Maximize size={15} aria-hidden />}
      </button>
    </div>
  );
}

export function Board({
  snapshot,
  locale,
  colorBlind,
  canAct,
  onPickRoute,
  onPickCity,
  highlightCities,
}: BoardProps) {
  const owned = useMemo(() => ownershipMap(snapshot), [snapshot]);
  const stationCities = useMemo(() => {
    const seats = new Map(snapshot.players.map((p) => [p.id, p.seat]));
    return new Map(snapshot.stations.map((s) => [s.cityId, seats.get(s.playerId) ?? 0]));
  }, [snapshot]);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Transient claim/station glow + the ticket-completion path sweep (cleared on a timer).
  // `armedGlowRoutes` = claimed-but-not-yet-shown (the store); `startedGlowRoutes` = glow actually
  // running (promoted by RouteGlowGate once the railway is ≥50% in view). The class reads the latter.
  const armedGlowRoutes = useAnimations((s) => s.glowingRoutes);
  const glowingStations = useAnimations((s) => s.glowingStations);
  const sweeps = useAnimations((s) => s.sweeps);
  const routeReveal = useAnimations((s) => s.routeReveal);
  const clearGlowRoute = useAnimations((s) => s.clearGlowRoute);
  const clearGlowStation = useAnimations((s) => s.clearGlowStation);
  const removeSweep = useAnimations((s) => s.removeSweep);

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
        <CameraSync snapshot={snapshot} viewportRef={viewportRef} />
        <RevealFramer viewportRef={viewportRef} />
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
          <svg className="board" viewBox={VIEWBOX} role="img" aria-label="Taiwan railway map">
            <defs>
              {/* The wild "rainbow locomotive" fill for ferry locomotive pips (one per loco the
                  crossing demands). Spectrum of the six liveries — the same rainbow as a loco card. */}
              <linearGradient id="ferryLocoRainbow" x1="0" y1="0" x2="1" y2="1">
                {LIVERY_COLORS.map((hex, i) => (
                  <stop key={hex} offset={i / (LIVERY_COLORS.length - 1)} stopColor={hex} />
                ))}
              </linearGradient>
            </defs>
            <Geography />

            {ROUTES.map((r) => {
              const g = ROUTE_GEOMETRY.get(r.id as string);
              if (!g) return null;

              const o = owned.get(r.id as string);
              const claimable = canAct && !o;
              // Unclaimed → route colour; claimed → owner's seat colour; locked → muted grey.
              const fill =
                o?.ownerSeat !== undefined
                  ? (SEAT_COLORS[o.ownerSeat % 5] ?? '#888')
                  : o?.locked
                    ? '#9aa0a6'
                    : colorOf(r.color);
              const carOpacity = o?.locked ? 0.45 : 1;
              const isFerry = r.ferryLocos > 0;
              const kind = r.isTunnel ? ' tunnel' : isFerry ? ' ferry' : '';
              const glowSeat = startedGlowRoutes.get(r.id as string);
              const cls =
                'route' +
                (claimable ? ' claimable' : '') +
                (o ? ' owned' : '') +
                (glowSeat !== undefined ? ' just-claimed' : '') +
                kind;
              // The owner's seat colour, exposed to CSS so a claimed route tints its whole roadbed
              // (the "background") to its owner — and the glow bloom reuses the same `--seat`.
              const seatCss = glowSeat ?? o?.ownerSeat;
              // Double-route siblings split apart by a perpendicular nudge that counter-scales with
              // the track weight (--inv-scale), so the twin tracks stay snug at any zoom.
              const groupStyle: CSSProperties = {
                ...(g.perp.x || g.perp.y
                  ? {
                      transform: `translate(calc(${g.perp.x.toFixed(3)}px * var(--inv-scale)), calc(${g.perp.y.toFixed(3)}px * var(--inv-scale)))`,
                    }
                  : null),
                ...(seatCss !== undefined
                  ? ({ '--seat': seatColor(seatCss) } as CSSProperties)
                  : null),
              };
              // Ferry locomotive pips: the crossing demands `ferryLocos` wild cards. Mark that many
              // pips (a centred block of the chain) as larger rainbow dots; the rest stay plain.
              const locoStart = Math.max(0, Math.floor((r.length - r.ferryLocos) / 2));

              return (
                <g
                  key={r.id as string}
                  className={cls}
                  style={groupStyle}
                  onClick={claimable ? () => onPickRoute(r.id as string) : undefined}
                >
                  {/* Paper roadbed seats the cars legibly over land and sea. */}
                  <path className="bed" d={g.path} />
                  {/* Tunnel: a dashed sleeper track shows between the shorter cars. */}
                  {r.isTunnel && <path className="tunnel-track" d={g.path} />}

                  {isFerry ? (
                    // Ferry: a dotted sea crossing carrying round pips. The `ferryLocos` pips that
                    // stand for the required wild cards are rainbow rectangles (oriented along the
                    // crossing); the others are ordinary round pips (and the whole chain takes the
                    // owner's colour once claimed).
                    <>
                      <path className="ferry-line" d={g.path} />
                      {g.slots.map((s, i) => {
                        const isLoco = !o && i >= locoStart && i < locoStart + r.ferryLocos;
                        return isLoco ? (
                          <rect
                            key={i}
                            className="slot ferry-loco"
                            x={-s.len / 2}
                            width={s.len}
                            fill="url(#ferryLocoRainbow)"
                            opacity={carOpacity}
                            transform={`translate(${s.x.toFixed(2)} ${s.y.toFixed(2)}) rotate(${s.angle.toFixed(1)})`}
                          />
                        ) : (
                          <circle
                            key={i}
                            className="ferry-pip"
                            cx={s.x}
                            cy={s.y}
                            fill={fill}
                            opacity={carOpacity}
                          />
                        );
                      })}
                    </>
                  ) : (
                    // Each car = one train-length, so the slot count reads the cost at a glance.
                    // x/width (along the path) are map-bound; y/height (thickness) counter-scale
                    // in CSS so the cars hold a constant on-screen weight as you zoom.
                    g.slots.map((s, i) => (
                      <rect
                        key={i}
                        className="slot"
                        x={-s.len / 2}
                        width={s.len}
                        fill={fill}
                        opacity={carOpacity}
                        transform={`translate(${s.x.toFixed(2)} ${s.y.toFixed(2)}) rotate(${s.angle.toFixed(1)})`}
                      />
                    ))
                  )}

                  {claimable && (
                    <path className="hit" d={g.path}>
                      <title>{`${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)} · ${r.length}`}</title>
                    </path>
                  )}
                  {/* Colour-blind aid: a glyph chip naming the colour you pay (length is the car count). */}
                  {colorBlind && !o && (
                    <g className="glyph-badge">
                      <circle cx={g.mid.x} cy={g.mid.y} />
                      <text x={g.mid.x} y={g.mid.y}>
                        {glyphOf(r.color)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {CITIES.map((c) => {
              const stationSeat = stationCities.get(c.id as string);
              const hasStation = stationSeat !== undefined;
              const buildable = canAct && !hasStation;
              const isHub = HUB_CITIES.has(c.id as string);
              // Tier drives the cartographic label level-of-detail (see game/lod.ts + the
              // [data-zoom] rules in game.css); islands always keep their label.
              const tier = cityTier(c.id as string);
              const cls =
                'city' +
                (c.isIsland ? ' island' : '') +
                (isHub ? ' hub' : '') +
                (tier !== 'minor' ? ` ${tier}` : '');
              const onPick = buildable ? () => onPickCity(c.id as string) : undefined;
              const builtSeat = glowingStations.get(c.id as string);
              const justBuilt = builtSeat !== undefined;
              const isTarget = highlightCities?.has(c.id as string) ?? false;
              return (
                <g key={c.id as string} className={isTarget ? `${cls} ticket-target` : cls}>
                  {/* Offered-ticket endpoint: a soft halo behind the marker so the player can trace
                      the railways a ticket needs while the chooser holds the rail. */}
                  {isTarget && <circle className="ticket-target-halo" cx={c.x} cy={c.y} />}
                  {/* Junctions where many lines converge read as a wider slot-shaped station;
                      ordinary stops stay round. Geometry comes from CSS (so it can grow with
                      zoom via --marker-scale); the transform just plants it on the city. */}
                  {isHub ? (
                    <rect
                      className={buildable ? 'city-hub buildable' : 'city-hub'}
                      transform={`translate(${c.x} ${c.y})`}
                      onClick={onPick}
                    >
                      <title>{cityName(c.id as string, locale)}</title>
                    </rect>
                  ) : (
                    <circle
                      className={buildable ? 'city-dot buildable' : 'city-dot'}
                      cx={c.x}
                      cy={c.y}
                      onClick={onPick}
                    >
                      <title>{cityName(c.id as string, locale)}</title>
                    </circle>
                  )}
                  {hasStation &&
                    (isHub ? (
                      <rect
                        className={justBuilt ? 'station-hub just-built' : 'station-hub'}
                        transform={`translate(${c.x} ${c.y})`}
                        style={{ fill: seatColor(stationSeat!) }}
                      />
                    ) : (
                      <circle
                        className={justBuilt ? 'station just-built' : 'station'}
                        cx={c.x}
                        cy={c.y}
                        style={{ fill: seatColor(stationSeat!) }}
                      />
                    ))}
                  {justBuilt && (
                    <circle
                      className="station-ring"
                      cx={c.x}
                      cy={c.y}
                      r={0.5}
                      style={{ '--seat': seatColor(builtSeat) } as CSSProperties}
                    />
                  )}
                  <text className="city-label" x={c.x} y={c.y}>
                    {cityName(c.id as string, locale)}
                  </text>
                </g>
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
          </svg>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
