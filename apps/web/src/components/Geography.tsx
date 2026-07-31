import type { MapGeography } from '@trm/map-data';
import { smoothClosedPath } from '@trm/map-data';
import {
  BASE_VIEW,
  ISLANDS,
  GRATICULE,
  TAIWAN_LAND_PATH,
  CENTRAL_RANGE_PATH,
  smoothCoastPath,
  type View,
} from '../game/geography';
import { ACTIVE_GEOGRAPHY } from '../game/catalog';

/** Renders the active map's cartography: the hand-authored Taiwan coast for official Taiwan (or
 *  any content without its own geography), else a custom map's cropped-world land silhouette. */
export function GeographyLayer() {
  return ACTIVE_GEOGRAPHY ? <CustomGeography geography={ACTIVE_GEOGRAPHY} /> : <Geography />;
}

const GRATICULE_STEP = 20;
/** Hard cap on graticule lines per axis. A custom map's `baseView` is third-party content (a
 *  cloned shared map in the builder, the active map in someone else's room), so the grid must be
 *  bounded by the code and not by the view: an absurd span would otherwise allocate until the tab
 *  dies. Authored views are a handful of lines per axis, far under this. */
const MAX_GRATICULE_LINES = 512;

/** Grid line positions from the first multiple of the step at or after `start`, up to `end`. */
function axisLines(start: number, end: number): number[] {
  const first = Math.ceil(start / GRATICULE_STEP) * GRATICULE_STEP;
  const vs: number[] = [];
  let prev = Number.NaN;
  for (let i = 0; i < MAX_GRATICULE_LINES; i++) {
    const v = first + i * GRATICULE_STEP;
    // Same `< end` bound as an incrementing walk, but indexed off `first`, so the loop count is
    // fixed even where the step is below the float ULP (a view at ±1e300 never advances at all)
    // and a non-advancing value stops rather than repeating itself — and its React key.
    if (!(v < end) || v === prev) break;
    vs.push(v);
    prev = v;
  }
  return vs;
}

/** A simple grid at a fixed step, sized to the map's own viewBox (custom maps have no hand-tuned
 *  graticule the way Taiwan does). */
function graticuleFor(view: View): { xs: number[]; ys: number[] } {
  return { xs: axisLines(view.x, view.x + view.w), ys: axisLines(view.y, view.y + view.h) };
}

export interface CustomGeographyProps {
  geography: MapGeography;
  /** Land ring indices to visually highlight (the fine-tune/trim stage's selection). */
  selectedRings?: ReadonlySet<number>;
  /** Making land rings clickable is opt-in — only the fine-tune/trim stage needs it, so the live
   *  board/backdrop keep passing pointer events straight through to whatever's beneath them. */
  onRingClick?: (index: number) => void;
}

/** A custom map's cropped-world land silhouette: one smoothed path per ring, plus its optional
 *  hand-authored mountain relief (drawn like Taiwan's Central Range). No islands/compass — those
 *  remain hand-tuned Taiwan decorations with no generic equivalent. */
export function CustomGeography({ geography, selectedRings, onRingClick }: CustomGeographyProps) {
  const { baseView, land, borders, relief } = geography;
  const { xs, ys } = graticuleFor(baseView);
  return (
    <g className="geo" pointerEvents={onRingClick ? 'auto' : 'none'}>
      <rect
        className="sea"
        x={baseView.x - 40}
        y={baseView.y - 40}
        width={baseView.w + 80}
        height={baseView.h + 80}
      />
      <g className="graticule">
        {ys.map((y) => (
          <line key={`gy${y}`} x1={baseView.x - 6} y1={y} x2={baseView.x + baseView.w + 6} y2={y} />
        ))}
        {xs.map((x) => (
          <line key={`gx${x}`} x1={x} y1={baseView.y - 4} x2={x} y2={baseView.y + baseView.h + 4} />
        ))}
      </g>
      {land.map((ring, i) => {
        const d = smoothCoastPath(ring);
        const selected = selectedRings?.has(i);
        return (
          <g
            key={i}
            className={
              onRingClick ? `land-ring${selected ? ' land-ring--selected' : ''}` : undefined
            }
            onClick={
              onRingClick
                ? (e) => {
                    e.stopPropagation();
                    onRingClick(i);
                  }
                : undefined
            }
          >
            <path className="land-surf" d={d} />
            <path className="land" d={d} />
          </g>
        );
      })}
      {relief?.map((ring, i) => {
        // Hand-authored blobs like Taiwan's Central Range, so the same uniform smoothing applies.
        const d = smoothClosedPath(ring);
        return (
          <g key={`relief-${i}`}>
            <path className="relief" d={d} />
            <path className="relief-ridge" d={d} />
          </g>
        );
      })}
      {borders?.map((ring, i) => (
        <path key={`border-${i}`} className="country-border" d={smoothCoastPath(ring)} />
      ))}
    </g>
  );
}

/**
 * Static cartography: sea, graticule, coastline, central-range relief, islands, compass. Shared by
 * the live `Board` and the non-interactive `MapBackdrop`, so the login map matches the game map.
 */
export function Geography() {
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
