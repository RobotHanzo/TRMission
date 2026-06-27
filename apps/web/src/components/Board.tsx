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
import { CITIES, ROUTES, cityById, cityName } from '../game/content';
import { ownershipMap } from '../game/view';
import {
  BASE_VIEW,
  ISLANDS,
  GRATICULE,
  TAIWAN_LAND_PATH,
  CENTRAL_RANGE_PATH,
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

// Perpendicular offset for double-route siblings so the parallel tracks don't overlap.
const doubleOffsets = (): Map<string, number> => {
  const groups = new Map<string, string[]>();
  for (const r of ROUTES)
    if (r.doubleGroup)
      groups.set(r.doubleGroup, [...(groups.get(r.doubleGroup) ?? []), r.id as string]);
  const m = new Map<string, number>();
  for (const ids of groups.values()) {
    ids.sort();
    ids.forEach((id, i) => m.set(id, (i - (ids.length - 1) / 2) * 1.8));
  }
  return m;
};

const colorOf = (rc: RouteColor): string =>
  rc === 'GRAY' ? GRAY_TOKEN.hex : CARD_COLOR_TOKENS[rc].hex;
const glyphOf = (rc: RouteColor): string =>
  rc === 'GRAY' ? GRAY_TOKEN.glyph : CARD_COLOR_TOKENS[rc].glyph;

// Hub cities whose labels survive the zoomed-out view; the dense corridor in between
// reveals its labels as you zoom in (cartographic level-of-detail).
const MAJORS = new Set([
  'taipei',
  'hsinchu',
  'taichung',
  'chiayi',
  'tainan',
  'kaohsiung',
  'hualien',
  'taitung',
  'yilan',
  'hengchun',
]);
// Home is `initialScale` 1.9 → "mid", so the default view already shows every label and
// length badge; zooming out to ~minScale reaches "far" (a clean labels-thinned overview).
const zoomBucket = (scale: number): string => (scale < 1.4 ? 'far' : scale < 2.4 ? 'mid' : 'near');

/**
 * Reflects the live zoom onto the viewport: `data-zoom` drives label/badge level-of-detail,
 * and `--inv-scale` (≈ 1/scale) counter-scales the markers, labels, and tracks so they keep a
 * roughly constant on-screen size as the geography zooms — instead of ballooning (Google-Maps
 * behaviour). The land, coastline, and relief are NOT counter-scaled, so the island still grows.
 */
function ZoomTracker({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  useTransformEffect((ref) => {
    const el = targetRef.current;
    if (!el) return;
    const s = ref.state.scale;
    el.dataset.zoom = zoomBucket(s);
    el.style.setProperty('--inv-scale', String(Math.max(0.12, Math.min(1.5, 1 / s))));
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
  const { zoomIn, zoomOut, resetTransform } = useControls();
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
      <button type="button" aria-label={t('zoomIn')} onClick={() => zoomIn()}>
        <Plus size={16} aria-hidden />
      </button>
      <button type="button" aria-label={t('zoomOut')} onClick={() => zoomOut()}>
        <Minus size={16} aria-hidden />
      </button>
      <button type="button" aria-label={t('resetView')} onClick={() => resetTransform()}>
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
  const offsets = useMemo(doubleOffsets, []);
  const owned = useMemo(() => ownershipMap(snapshot), [snapshot]);
  const stationCities = useMemo(() => new Set(snapshot.stations.map((s) => s.cityId)), [snapshot]);
  const viewportRef = useRef<HTMLDivElement>(null);

  return (
    <div className="board-viewport" data-zoom="far" ref={viewportRef}>
      <TransformWrapper
        minScale={0.8}
        maxScale={8}
        initialScale={1.9}
        centerOnInit
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
              const a = cityById.get(r.a as string);
              const b = cityById.get(r.b as string);
              if (!a || !b) return null;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = Math.hypot(dx, dy) || 1;
              const off = offsets.get(r.id as string) ?? 0;
              const nx = (-dy / len) * off;
              const ny = (dx / len) * off;
              const x1 = a.x + nx;
              const y1 = a.y + ny;
              const x2 = b.x + nx;
              const y2 = b.y + ny;
              const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };

              const o = owned.get(r.id as string);
              const claimable = canAct && !o;
              const stroke =
                o?.ownerSeat !== undefined
                  ? (SEAT_COLORS[o.ownerSeat % 5] ?? '#888')
                  : o?.locked
                    ? '#9aa0a6'
                    : colorOf(r.color);
              // Tunnel = dashes, ferry = dots; the dash pattern is counter-scaled in CSS
              // (with var(--inv-scale)) so it stays a clean dotted/dashed line at every zoom
              // instead of fat blobs when zoomed out.
              const kind = r.isTunnel ? ' tunnel' : r.ferryLocos > 0 ? ' ferry' : '';

              const cls = 'route' + (claimable ? ' claimable' : '') + (o ? ' owned' : '') + kind;
              return (
                <g
                  key={r.id as string}
                  className={cls}
                  onClick={claimable ? () => onPickRoute(r.id as string) : undefined}
                >
                  {/* Paper casing so coloured tracks stay legible over land and sea. */}
                  <line className="track-casing" x1={x1} y1={y1} x2={x2} y2={y2} />
                  <line
                    className="track"
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={stroke}
                    opacity={o?.locked ? 0.4 : 1}
                  />
                  {claimable && (
                    <line className="hit" x1={x1} y1={y1} x2={x2} y2={y2}>
                      <title>{`${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)} · ${r.length}`}</title>
                    </line>
                  )}
                  {!o && (
                    <g className="len-badge">
                      <circle cx={mid.x} cy={mid.y} />
                      <text x={mid.x} y={mid.y}>
                        {colorBlind ? glyphOf(r.color) : r.length}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {CITIES.map((c) => {
              const hasStation = stationCities.has(c.id as string);
              const buildable = canAct && !hasStation;
              const cls =
                'city' +
                (c.isIsland ? ' island' : '') +
                (MAJORS.has(c.id as string) ? ' major' : '');
              return (
                <g key={c.id as string} className={cls}>
                  <circle
                    className={buildable ? 'city-dot buildable' : 'city-dot'}
                    cx={c.x}
                    cy={c.y}
                    onClick={buildable ? () => onPickCity(c.id as string) : undefined}
                  >
                    <title>{cityName(c.id as string, locale)}</title>
                  </circle>
                  {hasStation && <circle className="station" cx={c.x} cy={c.y} />}
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
