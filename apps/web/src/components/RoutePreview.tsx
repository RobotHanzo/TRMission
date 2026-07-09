import { useMemo } from 'react';
import type { MapGeography, TicketView } from '@trm/map-data';
import { ticketRect, smoothClosedPath } from '@trm/map-data';
import { ISLANDS, TAIWAN_LAND_PATH, CENTRAL_RANGE_PATH } from '../game/geography';

export interface PreviewCity {
  id: string;
  x: number;
  y: number;
}

interface Props {
  a: PreviewCity;
  b: PreviewCity;
  cities: readonly PreviewCity[];
  routes: readonly { a: string; b: string }[];
  /** A custom map's cropped-world cartography, or null to draw the hand-authored Taiwan coast. */
  geography: MapGeography | null;
  baseView: { x: number; y: number; w: number; h: number };
  /** Per-ticket displayed-area override; resolved against the map default carried on `geography`.
   *  `undefined` ⇒ no override (inherit the map default). */
  view?: TicketView | undefined;
  /** 'long' tints the connection EMU-blue (long route), 'short' uses ember. */
  tone: 'long' | 'short';
}

/**
 * A miniature of the active board for a mission card: the map silhouette and the faint rail web for
 * context, then the two ticket endpoints pinned and joined by a gentle neutral arc (no specific path
 * is implied — any connection scores). Purely presentational: content, geography, and the displayed
 * area all arrive as props, so the same component draws the in-game card (from the active catalog)
 * and the builder's live preview (from the draft).
 */
export function RoutePreview({ a, b, cities, routes, geography, baseView, view, tone }: Props) {
  const net = useMemo(() => {
    const byId = new Map(cities.map((c) => [c.id, c]));
    let d = '';
    for (const r of routes) {
      const ca = byId.get(r.a);
      const cb = byId.get(r.b);
      if (ca && cb) d += `M${ca.x} ${ca.y}L${cb.x} ${cb.y}`;
    }
    return d;
  }, [cities, routes]);

  const rect = ticketRect(view !== undefined ? { view } : {}, a, b, baseView, geography ?? undefined);
  const viewBox = `${rect.x} ${rect.y} ${rect.w} ${rect.h}`;

  // A gentle arc bowed perpendicular to the A–B line so it reads as "a connection", never as one
  // prescribed route.
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(14, len * 0.26);
  const sign = dx >= 0 ? -1 : 1;
  const cxp = mx + (-dy / len) * bow * sign;
  const cyp = my + (dx / len) * bow * sign;
  const arc = `M${a.x} ${a.y} Q${cxp} ${cyp} ${b.x} ${b.y}`;

  return (
    <svg
      viewBox={viewBox}
      className={`route-preview ${tone === 'long' ? 'rp-long' : 'rp-short'}`}
      role="img"
      aria-hidden
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      {geography ? (
        <g className="rp-geo">
          {geography.land.map((ring, i) => (
            <path key={i} className="rp-land" d={smoothClosedPath(ring)} />
          ))}
        </g>
      ) : (
        <>
          <path className="rp-land-surf" d={TAIWAN_LAND_PATH} />
          <path className="rp-land" d={TAIWAN_LAND_PATH} />
          <path className="rp-relief" d={CENTRAL_RANGE_PATH} />
          <g className="rp-islands">
            {ISLANDS.map((b2, i) => (
              <circle key={i} cx={b2.cx} cy={b2.cy} r={b2.r} />
            ))}
          </g>
        </>
      )}

      <path className="rp-net" d={net} />

      {/* connection: white casing under a coloured arc */}
      <path className="rp-arc-casing" d={arc} />
      <path className="rp-arc" d={arc} />

      {/* endpoint pins */}
      {[a, b].map((c) => (
        <g key={c.id} className="rp-pin">
          <circle className="rp-pin-halo" cx={c.x} cy={c.y} r="3.4" />
          <circle className="rp-pin-dot" cx={c.x} cy={c.y} r="1.7" />
          <circle className="rp-pin-core" cx={c.x} cy={c.y} r="0.7" />
        </g>
      ))}

      {/* faint city dots for the rest, so the network has anchors */}
      <g className="rp-cities">
        {cities.map((c) =>
          c.id === a.id || c.id === b.id ? null : (
            <circle key={c.id} cx={c.x} cy={c.y} r="0.5" />
          ),
        )}
      </g>
    </svg>
  );
}
