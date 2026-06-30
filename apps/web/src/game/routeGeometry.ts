import { CITIES, ROUTES, cityById } from './content';

/**
 * Route cartography: every route is drawn as a gentle curve carrying a chain of discrete
 * "car-slot" segments (one rounded rectangle per train-length), the way a Ticket-to-Ride
 * board reads. Two problems the straight-line layout had, solved here geometrically:
 *
 *  1. Express routes that skip a town (e.g. Taichung→Yuanlin past Changhua) used to run
 *     straight over the stacked short-route chain. Each route now bows AWAY from the most
 *     intruding city it would otherwise cross, so the express arcs clear of the corridor.
 *  2. Double-route siblings barely separated. They are now two STRAIGHT parallel tracks sharing
 *     their stations, split by a perpendicular `perp` nudge the renderer counter-scales — so the
 *     pair stays a snug, constant-width twin track at every zoom. (Only bypass routes (1) curve.)
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
  /**
   * Diagonal sleeper ties for tunnel routes — each rendered as a `<rect>` rotated `angle + 45°`
   * relative to the track so the tie crosses at 45°. Only present when `r.isTunnel`.
   */
  readonly ties?: readonly Slot[];
  /** Curve midpoint — anchor for the colour-blind glyph chip. */
  readonly mid: { readonly x: number; readonly y: number };
  /**
   * Perpendicular nudge (board units) that separates a double-route pair into two parallel
   * tracks. The renderer multiplies it by `--inv-scale`, so the twin tracks hold a constant
   * on-screen gap (and stay snug, like the car thickness) at every zoom. `{0,0}` for a lone route.
   */
  readonly perp: { readonly x: number; readonly y: number };
}

/** Half the (counter-scaled) on-screen gap between a double-route pair's two parallel tracks. */
const DOUBLE_GAP = 1.35;
/** A non-endpoint city within this distance of a straight route is "in the way". */
const INTRUSION_DIST = 5.5;
/** How firmly to arc around an intruding city (scales the raw clearance). */
const BOW_GAIN = 0.72;
/** Cap so no single route balloons across the board. */
const MAX_BOW = 4.6;

/**
 * Hand-tuned outward bows (board units, signed along the chord normal) for routes whose straight
 * or auto-bowed path would cut across other content. Each value arcs the route into open space;
 * it replaces the auto-bow and is NOT clamped by MAX_BOW, and it composes with the double-gap so a
 * pair bows together yet stays a twin track. Positive/negative just picks the side.
 */
const BOW_OVERRIDE: Record<string, number> = {
  // Keelung–Matsu ferry: the straight crossing skims Tamsui and the north coast, and the auto-bow
  // would push it further into land — arc it north over the open sea (but kept inside the top edge).
  R81: 6,
  // Hsinchu–Miaoli: the auto-bow leans east into the corridor; flip it west, clear of Zhunan.
  R17: 4,
  // Taoyuan–Hsinchu: the auto-bow leans south-east over the Zhongli junction; bend it the other
  // way (north-west, toward the coast) instead.
  R14: 4,
  // Hengchun–Taitung: bending inland (north-west, past Dawu) swings the curve within 0.2 units of
  // Zhiben — nearly drawing through that station even though it isn't an endpoint. A full flip
  // toward the coast clears both, but the coastline here hugs close, so keep the bow modest —
  // any more and the curve pokes out over open water.
  R70: 1,
  // Kaohsiung–Kinmen ferry: the straight crossing runs right over Penghu — and the auto-bow skips
  // it because Penghu is an island. Curve it south-west through the open strait, clear of Penghu.
  // (The Kaohsiung–Penghu ferry has no intruder, so it stays straight on its own.)
  R85: -5,
  // Taipei–Yilan tunnel: the auto-bow would arc it away from Toucheng, but the Xuehe Tunnel runs
  // straight through the mountains — force it to zero so it draws as a direct line.
  R18: 0,
  // Taoyuan–Yilan tunnel (北橫): Banqiao sits almost exactly on the straight chord, so the auto-bow
  // swings hard north to dodge it — straight through the Taipei hub, crossing Ruifang–Taipei,
  // both Taipei–Banqiao tracks, and the Taipei–Yilan tunnel. Flip it south instead, clear of Taipei.
  R91: 4,
  // Nantou–Yuli tunnel (中橫): the auto-bow swings west to dodge Sun Moon Lake and ends up running
  // almost on top of the Nantou–Alishan route for most of its length. The Central Cross-Island
  // Highway runs fairly direct through the mountains anyway — force it straight, which clears both
  // Sun Moon Lake and Nantou–Alishan.
  R92: 0,
};

/** Cap on a single car's length so long routes read as many cars, not few long bars. */
const SLOT_MAX_LEN = 2.6;
/** Fraction of the per-car spacing a normal car fills (the remainder is the gap). */
const SLOT_FILL = 0.86;
/** Tunnels use shorter cars so the dashed track shows between them. */
const SLOT_FILL_TUNNEL = 0.62;
/** Board units between a tunnel's diagonal sleeper ties. */
const TIE_SPACING = 1.1;

/** How a route deviates from its straight chord. */
interface RouteOffset {
  /** Signed half-gap (board units) separating a double-pair's two parallel tracks; 0 otherwise. */
  readonly gap: number;
  /** Perpendicular bow of the curve's apex — a single route arcing around an intruding town. */
  readonly bow: number;
}

/**
 * Per-route deviation from the straight chord. A double-route pair's siblings keep their shared
 * endpoints but take equal-and-opposite perpendicular gaps (applied counter-scaled at render, so
 * the pair stays snug); every other route bows away from the nearest city its chord would cross.
 */
function computeOffsets(): Map<string, RouteOffset> {
  const out = new Map<string, RouteOffset>();

  const groups = new Map<string, string[]>();
  for (const r of ROUTES)
    if (r.doubleGroup)
      groups.set(r.doubleGroup, [...(groups.get(r.doubleGroup) ?? []), r.id as string]);
  for (const ids of groups.values()) {
    ids.sort();
    ids.forEach((id, i) =>
      out.set(id, { gap: (i - (ids.length - 1) / 2) * 2 * DOUBLE_GAP, bow: 0 }),
    );
  }

  for (const r of ROUTES) {
    if (out.has(r.id as string)) continue;
    const a = cityById.get(r.a as string);
    const b = cityById.get(r.b as string);
    if (!a || !b) {
      out.set(r.id as string, { gap: 0, bow: 0 });
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
    out.set(r.id as string, {
      gap: 0,
      bow: Math.max(-MAX_BOW, Math.min(MAX_BOW, best * BOW_GAIN)),
    });
  }

  // Hand-tuned outward bows win over the automatic one, keeping any double-gap intact.
  for (const [id, bow] of Object.entries(BOW_OVERRIDE)) {
    const o = out.get(id);
    if (o) out.set(id, { gap: o.gap, bow });
  }
  return out;
}

/** A city with at least this many incident routes reads as a hub — drawn as a station "slot". */
export const HUB_MIN_DEGREE = 4;

/** Cities where enough routes converge to warrant the larger slot-shaped station marker. */
function computeHubs(): Set<string> {
  const degree = new Map<string, number>();
  for (const r of ROUTES) {
    degree.set(r.a as string, (degree.get(r.a as string) ?? 0) + 1);
    degree.set(r.b as string, (degree.get(r.b as string) ?? 0) + 1);
  }
  const hubs = new Set<string>();
  for (const c of CITIES)
    if (!c.isIsland && (degree.get(c.id as string) ?? 0) >= HUB_MIN_DEGREE)
      hubs.add(c.id as string);
  return hubs;
}

/** Precomputed set of hub city ids (the content graph is static). */
export const HUB_CITIES: ReadonlySet<string> = computeHubs();

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
  return {
    x: 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x),
    y: 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y),
  };
};

/**
 * The path, car slots, and (for tunnels) diagonal ties for one quadratic-Bézier route running from
 * `a` through control point `c` to `b` and carrying `length` cars. This is the single source of a
 * route's on-board geometry — shared by the live map (every authored route) and by the standalone
 * specimen routes in the tutorial/encyclopedia, so a specimen's roadbed, cars and ties are produced
 * by exactly the same math as the board and can never drift from it.
 */
function curveShape(
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  length: number,
  isTunnel: boolean,
): { path: string; slots: Slot[]; ties?: Slot[]; mid: { x: number; y: number } } {
  // Arc length by sampling, to space the cars evenly.
  let arc = 0;
  let prev: { x: number; y: number } = a;
  for (let i = 1; i <= 24; i++) {
    const p = qPoint(a, c, b, i / 24);
    arc += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  const spacing = arc / length;
  const fillFrac = isTunnel ? SLOT_FILL_TUNNEL : SLOT_FILL;
  const slotLen = Math.min(spacing * fillFrac, SLOT_MAX_LEN);

  const slots: Slot[] = [];
  for (let i = 0; i < length; i++) {
    const t = (i + 0.5) / length;
    const p = qPoint(a, c, b, t);
    const tg = qTangent(a, c, b, t);
    slots.push({ x: p.x, y: p.y, angle: (Math.atan2(tg.y, tg.x) * 180) / Math.PI, len: slotLen });
  }

  // Tunnel routes get explicit tie positions so the renderer can draw each one as a <rect>
  // rotated angle+45° — the only way to tilt ties 45° relative to the track (stroke-dasharray
  // can only go perpendicular to the path, never diagonal).
  let ties: Slot[] | undefined;
  if (isTunnel) {
    ties = [];
    const tieCount = Math.round(arc / TIE_SPACING);
    for (let i = 0; i < tieCount; i++) {
      const t = (i + 0.5) / tieCount;
      const p = qPoint(a, c, b, t);
      const tg = qTangent(a, c, b, t);
      ties.push({ x: p.x, y: p.y, angle: (Math.atan2(tg.y, tg.x) * 180) / Math.PI, len: 0 });
    }
  }

  const f = (v: number): string => v.toFixed(2);
  return {
    path: `M ${f(a.x)} ${f(a.y)} Q ${f(c.x)} ${f(c.y)} ${f(b.x)} ${f(b.y)}`,
    slots,
    ...(ties ? { ties } : {}),
    mid: qPoint(a, c, b, 0.5),
  };
}

function buildGeometry(): Map<string, RouteGeometry> {
  const offsets = computeOffsets();
  const out = new Map<string, RouteGeometry>();
  for (const r of ROUTES) {
    const a = cityById.get(r.a as string);
    const b = cityById.get(r.b as string);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const { gap, bow } = offsets.get(r.id as string) ?? { gap: 0, bow: 0 };
    // Every route keeps its endpoints on the two city centres. A bypass bows its apex around an
    // intruding town; a double pair instead carries a perpendicular `perp` nudge applied (counter-
    // scaled) at render time, so its twin tracks separate without ever leaving their stations.
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Control point chosen so the curve's apex deviates from the chord by exactly `bow`.
    const c = { x: mid.x + nx * 2 * bow, y: mid.y + ny * 2 * bow };
    const perp = gap ? { x: nx * gap, y: ny * gap } : { x: 0, y: 0 };
    out.set(r.id as string, { ...curveShape(a, c, b, r.length, !!r.isTunnel), perp });
  }
  return out;
}

/** Per-car spacing (board units) for a standalone straight specimen route — a car plus its gap. */
export const STRAIGHT_PITCH = 2.56;

/**
 * Geometry for a standalone STRAIGHT route with no map context — a horizontal chain of `length`
 * cars centred at `(cx, cy)`, spanning `length * STRAIGHT_PITCH` board units. The tutorial and
 * encyclopedia specimens build their routes through here so their cars, roadbed and ties come out
 * of the very same {@link curveShape} math as the live board (rendered with the shared RouteShape).
 */
export function straightRouteGeometry(
  length: number,
  isTunnel: boolean,
  cx: number,
  cy: number,
): RouteGeometry {
  const half = (length * STRAIGHT_PITCH) / 2;
  const a = { x: cx - half, y: cy };
  const c = { x: cx, y: cy };
  const b = { x: cx + half, y: cy };
  return { ...curveShape(a, c, b, length, isTunnel), perp: { x: 0, y: 0 } };
}

/** Precomputed once — the content graph is static, so geometry never changes at runtime. */
export const ROUTE_GEOMETRY: Map<string, RouteGeometry> = buildGeometry();
