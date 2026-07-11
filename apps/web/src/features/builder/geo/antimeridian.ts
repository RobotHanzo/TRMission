import type { Ring, Point } from './clip';
import type { CropBBox } from './projection';

/** Longitude span (degrees) of a bbox. */
export function lonSpan(bbox: CropBBox): number {
  return bbox.lonMax - bbox.lonMin;
}

/** Copy of `rings` with every point translated in longitude by `delta` (e.g. +360 / -360). */
export function shiftLon(rings: readonly Ring[], delta: number): Ring[] {
  return rings.map((ring) => ring.map(([lon, lat]) => [lon + delta, lat] as Point));
}

/** Copy of `rings` with every point whose lon < 0 shifted by +360° — per-point and conditional,
 *  NOT shiftLon(rings, 360). Only the western points move, which is what stitches an
 *  antimeridian-crossing landmass (e.g. Russia's -179° tip) contiguous with its eastern body. */
export function unwrapEast(rings: readonly Ring[]): Ring[] {
  return rings.map((ring) =>
    ring.map(([lon, lat]) => (lon < 0 ? ([lon + 360, lat] as Point) : ([lon, lat] as Point))),
  );
}

/** Lon/lat bounding box of a set of rings, or null for empty input. */
export function boundsOfRings(rings: readonly Ring[]): CropBBox | null {
  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < lonMin) lonMin = lon;
      if (lon > lonMax) lonMax = lon;
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
    }
  }
  if (!Number.isFinite(lonMin)) return null;
  return { lonMin, lonMax, latMin, latMax };
}

/** Pick whichever of {raw rings, east-unwrapped rings} has the smaller longitude span, so a
 *  seam-crossing selection (Russia, Fiji) becomes contiguous while a genuinely-wide but
 *  non-crossing selection (e.g. France + French Guiana) is left untouched. Null for empty input. */
export function chooseMinimalLonRepresentation(
  rings: readonly Ring[],
): { rings: readonly Ring[]; bbox: CropBBox } | null {
  const rawBbox = boundsOfRings(rings);
  if (!rawBbox) return null;
  const unwrapped = unwrapEast(rings);
  const unwrappedBbox = boundsOfRings(unwrapped)!;
  return lonSpan(unwrappedBbox) < lonSpan(rawBbox)
    ? { rings: unwrapped, bbox: unwrappedBbox }
    : { rings, bbox: rawBbox };
}

/** Canonicalize a crop's longitude so lonMin ∈ [-180, 180) while preserving its width. A crop that
 *  wraps the antimeridian keeps lonMax > 180 (e.g. 160→200); a crop drawn entirely past the seam
 *  folds back to normal (190→250 becomes -170→-110). Latitudes pass through untouched. */
export function normalizeCropLon(bbox: CropBBox): CropBBox {
  const span = bbox.lonMax - bbox.lonMin;
  const lonMin = ((((bbox.lonMin + 180) % 360) + 360) % 360) - 180;
  return { lonMin, lonMax: lonMin + span, latMin: bbox.latMin, latMax: bbox.latMax };
}
