import { CITIES, ROUTES, cityById } from './content';

/**
 * Route cartography: every route is drawn as a gentle curve carrying a chain of discrete
 * "car-slot" segments (one rounded rectangle per train-length), the way a Ticket-to-Ride
 * board reads. Two problems the straight-line layout had, solved here geometrically:
 *
 *  1. Express routes that skip a town (e.g. Taichung→Yuanlin past Changhua) used to run
 *     straight over the stacked short-route chain. Each route now bows AWAY from the most
 *     intruding city it would otherwise cross, so the express arcs clear of the corridor.
 *  2. Double-route siblings barely separated. They now bow to opposite sides by a clear gap.
 *
 * The slot count communicates the route length, so the map needs no number badges.
 */

export interface Slot {
  /** Centre of the car in board units (x 0…100 west→east, y 0…100 north→south). */
  readonly x: number;
  readonly y: number;
  /** Orientation along the curve, in degrees (for an SVG `rotate`). */
  readonly angle: number;
  /** Length of this car along the path, in board units. */
  readonly len: number;
}

export interface RouteGeometry {
  /** Quadratic-Bézier path string (`M…Q…`) for the roadbed + click target. */
  readonly path: string;
  /** One car per train-length, centred and oriented along the curve. */
  readonly slots: readonly Slot[];
  /** Curve midpoint — anchor for the colour-blind glyph chip. */
  readonly mid: { readonly x: number; readonly y: number };
}

/** Half the perpendicular gap between a double-route pair's two arcs. */
const DOUBLE_BOW = 1.5;
/** A non-endpoint city within this distance of a straight route is "in the way". */
const INTRUSION_DIST = 5.5;
/** How firmly to arc around an intruding city (scales the raw clearance). */
const BOW_GAIN = 0.72;
/** Cap so no single route balloons across the board. */
const MAX_BOW = 4.6;

/** Cap on a single car's length so long routes read as many cars, not few long bars. */
const SLOT_MAX_LEN = 2.6;
/** Fraction of the per-car spacing a normal car fills (the remainder is the gap). */
const SLOT_FILL = 0.86;
/** Tunnels use shorter cars so the dashed track shows between them. */
const SLOT_FILL_TUNNEL = 0.62;

/**
 * Signed perpendicular bow for every route. Double siblings split symmetrically; every other
 * route bows away from the nearest city its chord would otherwise pass over.
 */
function computeBows(): Map<string, number> {
  const bow = new Map<string, number>();

  const groups = new Map<string, string[]>();
  for (const r of ROUTES)
    if (r.doubleGroup)
      groups.set(r.doubleGroup, [...(groups.get(r.doubleGroup) ?? []), r.id as string]);
  for (const ids of groups.values()) {
    ids.sort();
    ids.forEach((id, i) => bow.set(id, (i - (ids.length - 1) / 2) * 2 * DOUBLE_BOW));
  }

  for (const r of ROUTES) {
    if (bow.has(r.id as string)) continue;
    const a = cityById.get(r.a as string);
    const b = cityById.get(r.b as string);
    if (!a || !b) {
      bow.set(r.id as string, 0);
      continue;
    }
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1;
    const len = Math.sqrt(len2);
    const nx = -aby / len; // unit normal to the chord
    const ny = abx / len;
    let best = 0;
    for (const c of CITIES) {
      if (c.id === r.a || c.id === r.b || c.isIsland) continue;
      const t = ((c.x - a.x) * abx + (c.y - a.y) * aby) / len2;
      if (t < 0.15 || t > 0.85) continue; // only cities genuinely between the endpoints
      const fx = a.x + t * abx;
      const fy = a.y + t * aby;
      const dx = c.x - fx;
      const dy = c.y - fy;
      const dist = Math.hypot(dx, dy);
      if (dist > INTRUSION_DIST) continue;
      // Push to the side opposite the city; magnitude grows as it gets closer to the chord.
      const side = dx * nx + dy * ny;
      const signed = -Math.sign(side || 1) * (INTRUSION_DIST - dist);
      if (Math.abs(signed) > Math.abs(best)) best = signed;
    }
    bow.set(r.id as string, Math.max(-MAX_BOW, Math.min(MAX_BOW, best * BOW_GAIN)));
  }
  return bow;
}

const qPoint = (
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } => {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
};

const qTangent = (
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } => {
  const u = 1 - t;
  return { x: 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x), y: 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y) };
};

function buildGeometry(): Map<string, RouteGeometry> {
  const bows = computeBows();
  const out = new Map<string, RouteGeometry>();
  for (const r of ROUTES) {
    const a = cityById.get(r.a as string);
    const b = cityById.get(r.b as string);
    if (!a || !b) continue;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len = Math.hypot(abx, aby) || 1;
    const nx = -aby / len;
    const ny = abx / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const bow = bows.get(r.id as string) ?? 0;
    // Control point chosen so the curve's apex deviates from the chord by exactly `bow`.
    const c = { x: mid.x + nx * 2 * bow, y: mid.y + ny * 2 * bow };

    // Arc length by sampling, to space the cars evenly.
    let arc = 0;
    let prev: { x: number; y: number } = a;
    for (let i = 1; i <= 24; i++) {
      const p = qPoint(a, c, b, i / 24);
      arc += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    const spacing = arc / r.length;
    const fill = r.isTunnel ? SLOT_FILL_TUNNEL : SLOT_FILL;
    const slotLen = Math.min(spacing * fill, SLOT_MAX_LEN);

    const slots: Slot[] = [];
    for (let i = 0; i < r.length; i++) {
      const t = (i + 0.5) / r.length;
      const p = qPoint(a, c, b, t);
      const tg = qTangent(a, c, b, t);
      slots.push({ x: p.x, y: p.y, angle: (Math.atan2(tg.y, tg.x) * 180) / Math.PI, len: slotLen });
    }

    const f = (v: number): string => v.toFixed(2);
    out.set(r.id as string, {
      path: `M ${f(a.x)} ${f(a.y)} Q ${f(c.x)} ${f(c.y)} ${f(b.x)} ${f(b.y)}`,
      slots,
      mid: qPoint(a, c, b, 0.5),
    });
  }
  return out;
}

/** Precomputed once — the content graph is static, so geometry never changes at runtime. */
export const ROUTE_GEOMETRY: Map<string, RouteGeometry> = buildGeometry();
