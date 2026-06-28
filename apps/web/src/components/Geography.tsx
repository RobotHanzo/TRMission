import { BASE_VIEW, ISLANDS, GRATICULE, TAIWAN_LAND_PATH, CENTRAL_RANGE_PATH } from '../game/geography';

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
