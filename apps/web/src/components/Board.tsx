import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TransformWrapper,
  TransformComponent,
  useControls,
  useTransformEffect,
} from 'react-zoom-pan-pinch';
import { Plus, Minus, LocateFixed, Maximize, Minimize } from 'lucide-react';
import type { GameSnapshot } from '@trm/proto';
import type { RouteColor } from '@trm/shared';
import { CITIES, ROUTES, cityName } from '../game/content';
import { ROUTE_GEOMETRY, HUB_CITIES } from '../game/routeGeometry';
import { ownershipMap } from '../game/view';
import { zoomBucket, cityTier } from '../game/lod';
import {
  BASE_VIEW,
  ISLANDS,
  GRATICULE,
  TAIWAN_LAND_PATH,
  CENTRAL_RANGE_PATH,
  homeScale,
} from '../game/geography';
import { CARD_COLOR_TOKENS, GRAY_TOKEN, SEAT_COLORS } from '../theme/colors';
import type { Locale } from '../store/ui';

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
 * Zoom controls wired to the pan/zoom context, plus reset (re-centre) and a real
 * fullscreen toggle that drives the Fullscreen API on the board viewport.
 */
function MapControls({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, centerView, instance } = useControls();
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Re-centre at the cover-fit for the *current* viewport, so reset fills the board whatever
  // its shape (a fixed scale only ever frames one window size — see homeScale).
  const resetView = (): void => {
    const wrap = instance.wrapperComponent;
    centerView(homeScale(wrap?.offsetWidth ?? 0, wrap?.offsetHeight ?? 0), 200, 'easeOut');
  };

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
      <button type="button" aria-label={t('zoomIn')} onClick={() => zoomIn()}>
        <Plus size={16} aria-hidden />
      </button>
      <button type="button" aria-label={t('zoomOut')} onClick={() => zoomOut()}>
        <Minus size={16} aria-hidden />
      </button>
      <button type="button" aria-label={t('resetView')} onClick={resetView}>
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

  // data-zoom seeds at the home tier (initialScale ≈ home → district) to avoid a first-paint
  // label flash before ZoomTracker takes over.
  return (
    <div className="board-viewport" data-zoom="district" ref={viewportRef}>
      <TransformWrapper
        minScale={0.8}
        maxScale={8}
        initialScale={1.9}
        centerOnInit
        // Snap to the cover-fit for the real viewport once measured, matching the reset button,
        // so first paint frames the island regardless of window shape (not the fixed 1.9 seed).
        onInit={(ref) => {
          const wrap = ref.instance.wrapperComponent;
          ref.centerView(homeScale(wrap?.offsetWidth ?? 0, wrap?.offsetHeight ?? 0), 0);
        }}
        wheel={{ step: 0.0022 }}
        doubleClick={{ mode: 'zoomIn', step: 0.6 }}
        panning={{ velocityDisabled: true }}
      >
        <ZoomTracker targetRef={viewportRef} />
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
              const cls = 'route' + (claimable ? ' claimable' : '') + (o ? ' owned' : '') + kind;
              // Double-route siblings split apart by a perpendicular nudge that counter-scales with
              // the track weight (--inv-scale), so the twin tracks stay snug at any zoom.
              const perpStyle =
                g.perp.x || g.perp.y
                  ? {
                      transform: `translate(calc(${g.perp.x.toFixed(3)}px * var(--inv-scale)), calc(${g.perp.y.toFixed(3)}px * var(--inv-scale)))`,
                    }
                  : undefined;

              return (
                <g
                  key={r.id as string}
                  className={cls}
                  style={perpStyle}
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
                      style={
                        hasStation ? { fill: SEAT_COLORS[stationSeat! % 5] ?? '#888' } : undefined
                      }
                    >
                      <title>{cityName(c.id as string, locale)}</title>
                    </rect>
                  ) : (
                    <circle
                      className={buildable ? 'city-dot buildable' : 'city-dot'}
                      cx={c.x}
                      cy={c.y}
                      onClick={onPick}
                      style={
                        hasStation ? { fill: SEAT_COLORS[stationSeat! % 5] ?? '#888' } : undefined
                      }
                    >
                      <title>{cityName(c.id as string, locale)}</title>
                    </circle>
                  )}
                  <text className="city-label" x={c.x} y={c.y}>
                    {cityName(c.id as string, locale)}
                  </text>
                </g>
              );
            })}
          </svg>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
