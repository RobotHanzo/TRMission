import { useMemo } from 'react';
import { CITIES, ROUTES, cityById } from '../game/content';
import { BASE_VIEW, ISLANDS, TAIWAN_LAND_PATH, CENTRAL_RANGE_PATH } from '../game/geography';

const VIEWBOX = `${BASE_VIEW.x} ${BASE_VIEW.y} ${BASE_VIEW.w} ${BASE_VIEW.h}`;

/** Every route as a faint hairline, drawn once and memoised — pure cartographic context. */
const networkPath = (): string => {
  let d = '';
  for (const r of ROUTES) {
    const a = cityById.get(r.a as string);
    const b = cityById.get(r.b as string);
    if (a && b) d += `M${a.x} ${a.y}L${b.x} ${b.y}`;
  }
  return d;
};

interface Props {
  aId: string;
  bId: string;
  /** 'long' tints the connection EMU-blue (long route), 'short' uses ember. */
  tone: 'long' | 'short';
}

/**
 * A miniature of the Taiwan board for a mission card: the island silhouette and
 * the faint rail web for context, then the two ticket endpoints pinned and joined
 * by a gentle neutral arc (no specific path is implied — any connection scores).
 */
export function RoutePreview({ aId, bId, tone }: Props) {
  const net = useMemo(networkPath, []);
  const a = cityById.get(aId);
  const b = cityById.get(bId);
  if (!a || !b) return null;

  // A gentle arc bowed perpendicular to the A–B line so it reads as "a connection",
  // never as one prescribed route.
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(14, len * 0.26);
  // Bow toward the sea (west) for a consistent, readable curve.
  const sign = dx >= 0 ? -1 : 1;
  const cxp = mx + (-dy / len) * bow * sign;
  const cyp = my + (dx / len) * bow * sign;
  const arc = `M${a.x} ${a.y} Q${cxp} ${cyp} ${b.x} ${b.y}`;

  return (
    <svg
      viewBox={VIEWBOX}
      className={`route-preview ${tone === 'long' ? 'rp-long' : 'rp-short'}`}
      role="img"
      aria-hidden
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <path className="rp-land-surf" d={TAIWAN_LAND_PATH} />
      <path className="rp-land" d={TAIWAN_LAND_PATH} />
      <path className="rp-relief" d={CENTRAL_RANGE_PATH} />
      <g className="rp-islands">
        {ISLANDS.map((b2, i) => (
          <circle key={i} cx={b2.cx} cy={b2.cy} r={b2.r} />
        ))}
      </g>

      <path className="rp-net" d={net} />

      {/* connection: white casing under a coloured arc */}
      <path className="rp-arc-casing" d={arc} />
      <path className="rp-arc" d={arc} />

      {/* endpoint pins */}
      {[a, b].map((c) => (
        <g key={c.id as string} className="rp-pin">
          <circle className="rp-pin-halo" cx={c.x} cy={c.y} r="3.4" />
          <circle className="rp-pin-dot" cx={c.x} cy={c.y} r="1.7" />
          <circle className="rp-pin-core" cx={c.x} cy={c.y} r="0.7" />
        </g>
      ))}

      {/* faint city dots for the rest, so the network has anchors */}
      <g className="rp-cities">
        {CITIES.map((c) =>
          c.id === a.id || c.id === b.id ? null : (
            <circle key={c.id as string} cx={c.x} cy={c.y} r="0.5" />
          ),
        )}
      </g>
    </svg>
  );
}
