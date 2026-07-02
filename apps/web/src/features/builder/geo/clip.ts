import type { CropBBox } from './projection';

export type Point = readonly [number, number];
export type Ring = readonly Point[];

type InsideTest = (p: Point) => boolean;
type Intersect = (a: Point, b: Point) => Point;

/** One Sutherland–Hodgman clip pass against a single half-plane. */
function clipEdge(points: readonly Point[], inside: InsideTest, intersect: Intersect): Point[] {
  if (points.length === 0) return [];
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i] as Point;
    const prev = points[(i - 1 + points.length) % points.length] as Point;
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

const lerpAtLon = (a: Point, b: Point, lon: number): Point => {
  const t = (lon - a[0]) / (b[0] - a[0]);
  return [lon, a[1] + t * (b[1] - a[1])];
};
const lerpAtLat = (a: Point, b: Point, lat: number): Point => {
  const t = (lat - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), lat];
};

/**
 * Clip a closed ring (lon/lat points) to a bbox via four sequential half-plane passes. Returns
 * an empty array if the ring lies entirely outside the box. The input ring is assumed closed
 * (first point implicitly connects back to the last) — do not repeat the first point at the end.
 */
export function clipRingToBBox(ring: Ring, bbox: CropBBox): Ring {
  let pts: Point[] = ring.slice() as Point[];
  pts = clipEdge(pts, (p) => p[0] >= bbox.lonMin, (a, b) => lerpAtLon(a, b, bbox.lonMin));
  if (pts.length === 0) return [];
  pts = clipEdge(pts, (p) => p[0] <= bbox.lonMax, (a, b) => lerpAtLon(a, b, bbox.lonMax));
  if (pts.length === 0) return [];
  pts = clipEdge(pts, (p) => p[1] >= bbox.latMin, (a, b) => lerpAtLat(a, b, bbox.latMin));
  if (pts.length === 0) return [];
  pts = clipEdge(pts, (p) => p[1] <= bbox.latMax, (a, b) => lerpAtLat(a, b, bbox.latMax));
  return pts;
}

/** Clip every ring in a multi-ring polygon set, dropping rings clipped down to nothing. */
export function clipRingsToBBox(rings: readonly Ring[], bbox: CropBBox): Ring[] {
  return rings.map((r) => clipRingToBBox(r, bbox)).filter((r) => r.length >= 3);
}
