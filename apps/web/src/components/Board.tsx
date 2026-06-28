import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
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
import { CITIES, ROUTES, cityById, cityName } from '../game/content';
import { ROUTE_GEOMETRY, HUB_CITIES } from '../game/routeGeometry';
import { ownershipMap } from '../game/view';
import { zoomBucket, cityTier } from '../game/lod';
import { transformToView, viewToTransform, type BoardTransform } from '../game/boardView';
import {
  BASE_VIEW,
  ISLANDS,
  GRATICULE,
  TAIWAN_LAND_PATH,
  CENTRAL_RANGE_PATH,
  fitTransform,
} from '../game/geography';
import { CARD_COLOR_TOKENS, GRAY_TOKEN, SEAT_COLORS } from '../theme/colors';
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

/** Static cartography: sea, graticule, coastline, central-range relief, islands, compass. */
function Geography() {
  return (
    <g className="geo" pointerEvents="none">
      <rect
        className="sea"
        x={BASE_VIEW.x - 40}
        y={BASE_VIEW.y - 40}
        width={BASE_VIEW.w + 80}
        height={BASE_VIEW.h + 80}
      />
      <g className="graticule">
        {GRATICULE.ys.map((y) => (
          <line key={`gy${y}`} x1={-6} y1={y} x2={80} y2={y} />
        ))}
        {GRATICULE.xs.map((x) => (
          <line key={`gx${x}`} x1={x} y1={-4} x2={x} y2={94} />
        ))}
      </g>

      <path className="land-surf" d={TAIWAN_LAND_PATH} />
      <path className="land" d={TAIWAN_LAND_PATH} />
      <path className="relief" d={CENTRAL_RANGE_PATH} />
      <path className="relief-ridge" d={CENTRAL_RANGE_PATH} />

      <g className="islands">
        {ISLANDS.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} />
        ))}
      </g>

      {/* Compass rose, tucked into the sea off the west coast. */}
      <g className="compass" transform="translate(12,82)">
        <circle r="3.6" />
        <path className="compass-n" d="M0 -3 L1 0 L0 -0.6 L-1 0 Z" />
        <path className="compass-s" d="M0 3 L1 0 L0 0.6 L-1 0 Z" />
        <text y="-4.4">N</text>
      </g>
    </g>
  );
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

/** Turn the follow toggle off without subscribing the caller to its state. */
const disengageFollow = (): void => {
  const ui = useUi.getState();
  if (ui.followActing) ui.setFollowActing(false);
};

/** Board coordinate (+ a stable key) of the most recent spatial action in the event tail. */
function latestActionPoi(
  events: readonly GameEvent[],
): { x: number; y: number; key: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]?.event;
    if (!e) continue;
    if (e.case === 'routeClaimed' || e.case === 'tunnelRevealed') {
      const g = ROUTE_GEOMETRY.get(e.value.routeId);
      if (g) return { x: g.mid.x, y: g.mid.y, key: `${e.case}:${e.value.routeId}:${i}` };
    } else if (e.case === 'stationBuilt') {
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
      if (!socket || w <= 0 || h <= 0) return;
      const view = transformToView(liveRef.current, w, h);
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
    if (w <= 0 || h <= 0) return;
    const t = viewToTransform(actingCamera.view, w, h);
    setTransform(t.positionX, t.positionY, t.scale, 150, 'easeOut');
  }, [followActing, myTurn, currentIsBot, current, actingCamera, setTransform, viewportRef]);

  // ── Follow a BOT actor: glide to the POI of each NEW spatial action ──
  const lastPoiKey = useRef<string | null>(null);
  useEffect(() => {
    if (!followActing || myTurn || !currentIsBot) {
      lastPoiKey.current = null;
      return;
    }
    const poi = latestActionPoi(recentEvents);
    if (!poi || poi.key === lastPoiKey.current) return;
    lastPoiKey.current = poi.key;
    const w = viewportRef.current?.clientWidth ?? 0;
    const h = viewportRef.current?.clientHeight ?? 0;
    if (w <= 0 || h <= 0) return;
    const t = viewToTransform({ cx: poi.x, cy: poi.y, span: BOT_FOLLOW_SPAN }, w, h);
    setTransform(t.positionX, t.positionY, t.scale, 600, 'easeOut');
  }, [followActing, myTurn, currentIsBot, recentEvents, setTransform, viewportRef]);

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
}: BoardProps) {
  const owned = useMemo(() => ownershipMap(snapshot), [snapshot]);
  const stationCities = useMemo(() => {
    const seats = new Map(snapshot.players.map((p) => [p.id, p.seat]));
    return new Map(snapshot.stations.map((s) => [s.cityId, seats.get(s.playerId) ?? 0]));
  }, [snapshot]);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Transient claim/station glow + the ticket-completion path sweep (cleared on a timer).
  const glowingRoutes = useAnimations((s) => s.glowingRoutes);
  const glowingStations = useAnimations((s) => s.glowingStations);
  const sweeps = useAnimations((s) => s.sweeps);
  const clearGlowRoute = useAnimations((s) => s.clearGlowRoute);
  const clearGlowStation = useAnimations((s) => s.clearGlowStation);
  const removeSweep = useAnimations((s) => s.removeSweep);

  useEffect(() => {
    if (glowingRoutes.size === 0) return;
    const timers = [...glowingRoutes.keys()].map((id) => window.setTimeout(() => clearGlowRoute(id), 1300));
    return () => timers.forEach(clearTimeout);
  }, [glowingRoutes, clearGlowRoute]);
  useEffect(() => {
    if (glowingStations.size === 0) return;
    const timers = [...glowingStations.keys()].map((id) => window.setTimeout(() => clearGlowStation(id), 1100));
    return () => timers.forEach(clearTimeout);
  }, [glowingStations, clearGlowStation]);
  useEffect(() => {
    if (sweeps.length === 0) return;
    const timers = sweeps.map((sw) => window.setTimeout(() => removeSweep(sw.id), sw.path.length * 320 + 900));
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
        <MapControls targetRef={viewportRef} />
        <TransformComponent
          wrapperClass="board-transform"
          contentClass="board-content"
          wrapperStyle={{ width: '100%', height: '100%' }}
        >
          <svg className="board" viewBox={VIEWBOX} role="img" aria-label="Taiwan railway map">
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
              const glowSeat = glowingRoutes.get(r.id as string);
              const cls =
                'route' +
                (claimable ? ' claimable' : '') +
                (o ? ' owned' : '') +
                (glowSeat !== undefined ? ' just-claimed' : '') +
                kind;
              // Double-route siblings split apart by a perpendicular nudge that counter-scales with
              // the track weight (--inv-scale), so the twin tracks stay snug at any zoom.
              const groupStyle: CSSProperties = {
                ...(g.perp.x || g.perp.y
                  ? {
                      transform: `translate(calc(${g.perp.x.toFixed(3)}px * var(--inv-scale)), calc(${g.perp.y.toFixed(3)}px * var(--inv-scale)))`,
                    }
                  : null),
                ...(glowSeat !== undefined ? ({ '--seat': seatColor(glowSeat) } as CSSProperties) : null),
              };

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
                    // Ferry: a dotted sea crossing carrying round locomotive pips, not land cars.
                    <>
                      <path className="ferry-line" d={g.path} />
                      {g.slots.map((s, i) => (
                        <circle
                          key={i}
                          className="ferry-pip"
                          cx={s.x}
                          cy={s.y}
                          fill={fill}
                          opacity={carOpacity}
                        />
                      ))}
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
              return (
                <g key={c.id as string} className={cls}>
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
          </svg>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
