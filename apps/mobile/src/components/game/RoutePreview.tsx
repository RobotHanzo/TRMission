// A miniature of the Taiwan board for a mission card (ports the web RoutePreview): the island
// silhouette and the faint rail web for context, then the two ticket endpoints pinned and joined
// by a gentle neutral arc (no specific path is implied — any connection scores). Colours inline
// the web's rp-* CSS values from the shared light palette.
import { useMemo } from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';
import {
  MAP_PALETTE_LIGHT,
  TAIWAN_BASE_VIEW,
  TAIWAN_CENTRAL_RANGE_PATH,
  TAIWAN_ISLANDS,
  TAIWAN_LAND_PATH,
} from '@trm/map-data';
import { CITIES, ROUTES, cityById } from '../../game/content';

const P = MAP_PALETTE_LIGHT;
const VIEWBOX = `${TAIWAN_BASE_VIEW.x} ${TAIWAN_BASE_VIEW.y} ${TAIWAN_BASE_VIEW.w} ${TAIWAN_BASE_VIEW.h}`;
/** EMU blue for long routes, express ember for short (the web --tr-blue / --tr-ember). */
const TONE_HEX = { long: P.blue, short: '#ee6b1f' } as const;

/** Every route as a faint hairline, drawn once — pure cartographic context. */
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
  const sign = dx >= 0 ? -1 : 1;
  const cxp = mx + (-dy / len) * bow * sign;
  const cyp = my + (dx / len) * bow * sign;
  const arc = `M${a.x} ${a.y} Q${cxp} ${cyp} ${b.x} ${b.y}`;
  const toneHex = TONE_HEX[tone];

  return (
    <Svg viewBox={VIEWBOX} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <Path d={TAIWAN_LAND_PATH} fill="none" stroke={P.sea} strokeWidth={2.2} opacity={0.5} />
      <Path
        d={TAIWAN_LAND_PATH}
        fill={P.land}
        stroke={P.coast}
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      <Path d={TAIWAN_CENTRAL_RANGE_PATH} fill={P.relief} opacity={0.5} />
      <G>
        {TAIWAN_ISLANDS.map((isl, i) => (
          <Circle
            key={i}
            cx={isl.cx}
            cy={isl.cy}
            r={isl.r}
            fill={P.land}
            stroke={P.coast}
            strokeWidth={0.4}
          />
        ))}
      </G>

      <Path
        d={net}
        fill="none"
        stroke={P.coast}
        strokeWidth={0.35}
        strokeLinecap="round"
        opacity={0.4}
      />

      {/* connection: surface casing under a coloured dashed arc */}
      <Path
        d={arc}
        fill="none"
        stroke={P.surface}
        strokeWidth={2.6}
        strokeLinecap="round"
        opacity={0.85}
      />
      <Path
        d={arc}
        fill="none"
        stroke={toneHex}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeDasharray="2.4 1.9"
      />

      {/* endpoint pins */}
      {[a, b].map((c) => (
        <G key={c.id as string}>
          <Circle cx={c.x} cy={c.y} r={3.4} fill={toneHex} opacity={0.2} />
          <Circle cx={c.x} cy={c.y} r={1.7} fill={toneHex} stroke={P.surface} strokeWidth={0.5} />
          <Circle cx={c.x} cy={c.y} r={0.7} fill={P.surface} />
        </G>
      ))}

      {/* faint city dots for the rest, so the network has anchors */}
      <G>
        {CITIES.map((c) =>
          c.id === a.id || c.id === b.id ? null : (
            <Circle key={c.id as string} cx={c.x} cy={c.y} r={0.5} fill={P.coast} opacity={0.55} />
          ),
        )}
      </G>
    </Svg>
  );
}
