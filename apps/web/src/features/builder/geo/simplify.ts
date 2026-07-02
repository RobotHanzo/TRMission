import type { Point, Ring } from './clip';

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / len2;
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(x - cx, y - cy);
}

/** Douglas–Peucker on an open polyline (endpoints always kept). */
function simplifyPolyline(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice() as Point[];
  let maxDist = -1;
  let maxIdx = 0;
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i] as Point, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist <= tolerance) return [first, last];
  const left = simplifyPolyline(points.slice(0, maxIdx + 1), tolerance);
  const right = simplifyPolyline(points.slice(maxIdx), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Douglas–Peucker on a closed ring: split at the point farthest from the centroid (an arbitrary
 *  but stable anchor) so the two open polylines it becomes both keep their shared endpoints. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 3 || tolerance <= 0) return ring;
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  let anchor = 0;
  let maxD = -1;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0] - cx, ring[i]![1] - cy);
    if (d > maxD) {
      maxD = d;
      anchor = i;
    }
  }
  const rotated = [...ring.slice(anchor), ...ring.slice(0, anchor), ring[anchor] as Point];
  const simplified = simplifyPolyline(rotated, tolerance);
  return simplified.slice(0, -1); // drop the duplicated closing point
}

/**
 * Simplify every ring, then — if the total vertex count still exceeds `maxVertices` — repeatedly
 * raise the tolerance and re-simplify until it fits or further simplification stops helping.
 * Rings simplified down below 3 vertices are dropped. Returns the final rings plus how many were
 * dropped, so the caller can warn rather than silently truncate.
 */
export function simplifyToFit(
  rings: readonly Ring[],
  opts: { startTolerance?: number; maxVertices: number; maxRings: number } = {
    maxVertices: 15000,
    maxRings: 400,
  },
): { rings: Ring[]; droppedRings: number } {
  let tolerance = opts.startTolerance ?? 0.05;
  let current: Ring[] = [];
  let dropped = 0;

  // Re-simplify from the ORIGINAL rings at a growing tolerance each pass (cheap at these vertex
  // caps, and avoids trying to track which surviving ring corresponds to which original index).
  for (let guard = 0; guard < 20; guard++) {
    const simplified = rings.map((r) => simplifyRing(r, tolerance)).filter((r) => r.length >= 3);
    const droppedForDegeneracy = rings.length - simplified.length;

    let candidate = simplified;
    let droppedForRingCap = 0;
    if (candidate.length > opts.maxRings) {
      // Too many separate landmasses: keep the largest N by vertex count (a cheap proxy for
      // area at this resolution — good enough to prefer continents over simplification noise).
      const sorted = [...candidate].sort((a, b) => b.length - a.length).slice(0, opts.maxRings);
      droppedForRingCap = candidate.length - sorted.length;
      candidate = sorted;
    }

    current = candidate;
    dropped = droppedForDegeneracy + droppedForRingCap;
    const totalVertices = current.reduce((s, r) => s + r.length, 0);
    if (totalVertices <= opts.maxVertices) break;
    tolerance *= 1.6;
  }
  return { rings: current, droppedRings: dropped };
}
