import polygonClipping, { type Polygon } from 'polygon-clipping';
import type { CropBBox } from './projection';

export type Point = readonly [number, number];
export type Ring = readonly Point[];

function rectPolygon(bbox: CropBBox): Polygon {
  const { lonMin, lonMax, latMin, latMax } = bbox;
  return [
    [
      [lonMin, latMin],
      [lonMax, latMin],
      [lonMax, latMax],
      [lonMin, latMax],
      [lonMin, latMin],
    ],
  ];
}

/**
 * Clip a closed ring (lon/lat points) to a bbox. A single input ring can legitimately clip into
 * *multiple* disjoint output rings: Natural Earth stores all of Afro-Eurasia as one connected land
 * ring (Europe/Asia/Africa are joined by land outside almost any reasonably-sized crop box), so a
 * crop spanning e.g. Europe and North Africa separates it into two unconnected landmasses. A
 * per-edge Sutherland–Hodgman clip (the previous implementation here) always emits exactly one
 * output ring, so it can't express that split — it instead bridges the pieces with a spurious
 * straight/curved edge cutting across the intervening sea (visible as a "land line" through open
 * water once rendered). `polygon-clipping`'s intersection is a full polygon-clipping algorithm
 * that splits correctly, and is already a project dependency (used for country-union elsewhere).
 * The input ring is assumed closed (first point implicitly connects back to the last) — do not
 * repeat the first point at the end.
 */
export function clipRingToBBox(ring: Ring, bbox: CropBBox): Ring[] {
  const poly: Polygon = [[...ring] as [number, number][]];
  const result = polygonClipping.intersection(poly, rectPolygon(bbox));
  // polygon-clipping closes every output ring and would report a hole as a second sub-ring; land
  // rings are exteriors only (see dissolveCountryRings), so only the exterior is kept.
  return result.flatMap((polygon) => {
    const exterior = polygon[0];
    if (!exterior || exterior.length < 4) return [];
    return [exterior.slice(0, -1) as Ring];
  });
}

/** Clip every ring in a multi-ring polygon set, dropping rings clipped down to nothing. */
export function clipRingsToBBox(rings: readonly Ring[], bbox: CropBBox): Ring[] {
  return rings.flatMap((r) => clipRingToBBox(r, bbox)).filter((r) => r.length >= 3);
}
