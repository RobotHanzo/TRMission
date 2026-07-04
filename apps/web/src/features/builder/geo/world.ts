import type { MapGeography } from '@trm/map-data';
import { WORLD_LAND } from './worldData';
import { isCrudeTaiwanRing, taiwanRings } from './taiwan';
import { WORLD_COUNTRIES, type CountryLand } from './worldCountries';
import { buildProjection, isValidCrop, type CropBBox } from './projection';
import { clipRingsToBBox, type Ring } from './clip';
import { simplifyToFit } from './simplify';

/** Natural Earth's 1:110m Taiwan is a crude 4-point blob — swapped for the game's own detailed
 *  silhouette (see geo/taiwan.ts) so Taiwan reads correctly once the crop tool is zoomed in. */
const WORLD_LAND_DETAILED: readonly Ring[] = WORLD_LAND.flatMap((ring) =>
  isCrudeTaiwanRing(ring) ? taiwanRings() : [ring],
);

export function worldLand() {
  return WORLD_LAND_DETAILED;
}

export interface CropResult {
  geography: MapGeography;
  /** Land rings dropped for being too small after simplification, or over the ring cap —
   *  surfaced so the crop UI can warn rather than silently truncate. */
  droppedRings: number;
}

/** simplifyToFit's default starting tolerance (0.05°) is tuned for a whole-world-ish crop; a
 *  tight crop around a small feature (e.g. Taiwan's outlying islands, each only ~0.03-0.06°
 *  across) needs a proportionally finer tolerance or Douglas-Peucker collapses it below the
 *  3-point floor and drops it — "too small" regardless of how small the crop itself is. Scaled
 *  to the crop's own span (clamped to the same 0.05° ceiling so a wide crop is unaffected). */
function startToleranceFor(crop: CropBBox): number {
  const avgSpan = (crop.lonMax - crop.lonMin + (crop.latMax - crop.latMin)) / 2;
  return Math.max(0.002, Math.min(0.05, avgSpan / 500));
}

/** Shared tail for both cropToGeography and countriesToGeography: simplify to fit the engine's
 *  caps, then project into board space. `crop` is stored on the result as cartography provenance
 *  regardless of whether it came from a drawn rectangle or a selected-countries union bbox. */
function finalizeGeography(rings: readonly Ring[], crop: CropBBox): CropResult {
  const { rings: simplified, droppedRings } = simplifyToFit(rings, {
    startTolerance: startToleranceFor(crop),
    maxVertices: 8000,
    maxRings: 200,
  });
  const { baseView, project } = buildProjection(crop);
  const land = simplified.map((ring) => ring.map(([lon, lat]) => project(lon, lat)));
  return { geography: { baseView, land, crop }, droppedRings };
}

/** Full crop pipeline: clip the world to the bbox, simplify to fit the engine's caps
 *  (validateGeography's limits), then project into board space. Null on an invalid crop. */
export function cropToGeography(crop: CropBBox): CropResult | null {
  if (!isValidCrop(crop)) return null;
  const clipped = clipRingsToBBox(WORLD_LAND_DETAILED, crop);
  return finalizeGeography(clipped, crop);
}

/** Taiwan gets the same detailed-silhouette splice here that WORLD_LAND_DETAILED applies for crop
 *  mode — worldCountries.ts's own 'TWN' entry only carries Natural Earth's crude admin-0 ring. */
function ringsForCountry(country: CountryLand): readonly Ring[] {
  return country.id === 'TWN' ? taiwanRings() : country.rings;
}

/** The lon/lat bounding box of a set of rings, or null for an empty input. */
function boundsOfRings(rings: readonly Ring[]): CropBBox | null {
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

/**
 * Turn a set of selected country ids into a MapGeography, mirroring cropToGeography but sourcing
 * rings directly from the selected countries — never clipping against WORLD_LAND — so picking
 * "France" can't drag in Belgium just because it falls inside the union bounding box. Null for an
 * empty/all-unmatched selection, or one whose union bbox isValidCrop still rejects.
 */
export function countriesToGeography(ids: readonly string[]): CropResult | null {
  const idSet = new Set(ids);
  const rings = WORLD_COUNTRIES.filter((c) => idSet.has(c.id)).flatMap(ringsForCountry);
  const bbox = boundsOfRings(rings);
  if (!bbox || !isValidCrop(bbox)) return null;
  return finalizeGeography(rings, bbox);
}
