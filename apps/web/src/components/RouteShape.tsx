// The single SVG rendering of a route's body — the paper roadbed, its chain of car slots, tunnel
// ties, and ferry pips/locomotives — drawn with the live board CSS classes. Shared by the live map
// (`Board.tsx`) and the tutorial/encyclopedia specimens (`Specimens.tsx`) so a specimen looks
// IDENTICAL to the real thing and can never drift from it. The caller owns the wrapping
// `<g className="route …">` (which carries the route's kind/owner/claim state) and the `<svg>`
// that pins `--inv-scale`; this component only draws what sits inside that group.
import { LIVERY_COLORS } from '../theme/colors';
import type { RouteGeometry } from '../game/routeGeometry';

/** The wild "rainbow locomotive" fill for ferry locomotive pips — the six liveries, the same
 *  spectrum as a loco card. Drop one inside any `<svg>` that renders a ferry via {@link RouteShape}. */
export function FerryLocoGradientDef() {
  return (
    <defs>
      <linearGradient id="ferryLocoRainbow" x1="0" y1="0" x2="1" y2="1">
        {LIVERY_COLORS.map((hex, i) => (
          <stop key={hex} offset={i / (LIVERY_COLORS.length - 1)} stopColor={hex} />
        ))}
      </linearGradient>
    </defs>
  );
}

export interface RouteShapeProps {
  geometry: RouteGeometry;
  isTunnel: boolean;
  isFerry: boolean;
  /** How many of the ferry's pips are the required-wild rainbow locomotives (a centred block);
   *  pass 0 for a non-ferry, or for a claimed ferry whose locos take the owner's colour. */
  ferryLocos: number;
  /** Train-length (car count) — drives the loco block's placement. */
  length: number;
  /** Car / pip fill: the route colour (unclaimed), the owner's seat colour, or muted grey (locked). */
  fill: string;
  /** Dimming for a locked (unclaimable double sibling) route. */
  carOpacity?: number;
  /** >0 ⇒ this broken rail is still unrepaired: a centred block of that many car slots renders
   *  as damaged (`.slot.broken-car`) with a crack bolt across the middle. Pass 0 once repaired. */
  brokenCarriages?: number;
}

/**
 * The inside of a route group: tunnel glow → roadbed → ties / ferry pips / cars, in the exact order
 * and with the exact classes the board stacks them.
 */
export function RouteShape({
  geometry: g,
  isTunnel,
  isFerry,
  ferryLocos,
  length,
  fill,
  carOpacity = 1,
  brokenCarriages = 0,
}: RouteShapeProps) {
  // The `ferryLocos` pips that stand for the required wild cards are a centred block of the chain.
  const locoStart = Math.max(0, Math.floor((length - ferryLocos) / 2));
  // A broken rail's damaged carriages are a centred block too (same placement rule as ferry locos).
  const brokenStart = Math.max(0, Math.floor((length - brokenCarriages) / 2));
  const isBrokenSlot = (i: number): boolean =>
    brokenCarriages > 0 && i >= brokenStart && i < brokenStart + brokenCarriages;
  return (
    <>
      {/* Tunnel: a wide faint-grey stroke on the railway path covers the tie extent. */}
      {isTunnel && <path className="tunnel-bg" d={g.path} />}
      {/* Paper roadbed seats the cars legibly over land and sea. */}
      <path className="bed" d={g.path} />
      {/* Tunnel: diagonal ties, each rotated angle+45° so they cross at 45° to the track. */}
      {isTunnel &&
        g.ties?.map((t, i) => (
          <rect
            key={i}
            className="tunnel-tie"
            transform={`translate(${t.x.toFixed(2)} ${t.y.toFixed(2)}) rotate(${(t.angle + 45).toFixed(1)})`}
          />
        ))}

      {isFerry ? (
        // Ferry: a dotted sea crossing carrying round pips. The `ferryLocos` pips that stand for the
        // required wild cards are rainbow rectangles (oriented along the crossing); the others are
        // ordinary round pips (and the whole chain takes the owner's colour once claimed).
        <>
          <path className="ferry-line" d={g.path} />
          {g.slots.map((s, i) => {
            const isLoco = ferryLocos > 0 && i >= locoStart && i < locoStart + ferryLocos;
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
        // Each car = one train-length, so the slot count reads the cost at a glance. x/width (along
        // the path) are map-bound; y/height (thickness) counter-scale in CSS so the cars hold a
        // constant on-screen weight as you zoom.
        g.slots.map((s, i) => (
          <rect
            key={i}
            className={isBrokenSlot(i) ? 'slot broken-car' : 'slot'}
            x={-s.len / 2}
            width={s.len}
            fill={fill}
            opacity={carOpacity}
            transform={`translate(${s.x.toFixed(2)} ${s.y.toFixed(2)}) rotate(${s.angle.toFixed(1)})`}
          />
        ))
      )}
      {/* The severed-track bolt across the route middle — the at-a-glance "斷軌" cue. */}
      {brokenCarriages > 0 && (
        <g
          className="break-mark"
          transform={`translate(${g.mid.x.toFixed(2)} ${g.mid.y.toFixed(2)})`}
        >
          <path d="M -1.7 -0.4 L -0.5 -0.75 L -0.05 0.05 L 1.1 -0.55 L 1.7 0.4 L 0.45 0.7 L 0 -0.05 L -1.15 0.55 Z" />
        </g>
      )}
    </>
  );
}
