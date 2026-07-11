import type { MapGeography } from '@trm/map-data';
import polygonClipping, { type Polygon } from 'polygon-clipping';
import { WORLD_LAND } from './worldData';
import { isCrudeTaiwanRing, taiwanRings } from './taiwan';
import { WORLD_COUNTRIES, type CountryLand } from './worldCountries';
import { buildProjection, isValidCrop, type CropBBox } from './projection';
import { clipRingsToBBox, type Ring } from './clip';
import { simplifyToFit } from './simplify';
import { chooseMinimalLonRepresentation } from './antimeridian';

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

/** The Douglas-Peucker starting tolerance for the simplify-to-fit pass.
 *
 *  This used to scale with the crop's span (finer for a tight crop, up to a 0.05° ceiling for a
 *  wide one). That tied coastline quality to selection size: enlarging the pick raised the
 *  tolerance and coarsened the coast — "geography degradation as selection enlarges". It's now a
 *  fixed value, so every selection keeps the same detail regardless of how much it spans. That's
 *  safe because the vendored land is already ~0.03°-simplified and the whole world fits the vertex
 *  budget (`finalizeGeography`'s caps) intact — there's never a need to trade detail for size. The
 *  value is finer than the source (so it strips nothing real) yet positive, so simplifyToFit's
 *  over-budget safety net can still raise it if a future, denser dataset ever needs it. `_crop` is
 *  kept so the call site is unchanged and to document that the tolerance is deliberately
 *  crop-independent. Exported for the regression test that pins this invariant. */
export function startToleranceFor(_crop: CropBBox): number {
  return 0.002;
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

/**
 * Merge touching/overlapping country exteriors before simplification and rendering. Admin-0
 * polygons each include their shared border, so keeping them as independent land rings makes the
 * live map draw two coastlines (and two sea-coloured shoreline strokes) through the middle of a
 * contiguous selection. Polygon union removes those internal borders and leaves one coastline per
 * connected landmass.
 *
 * MapGeography intentionally stores land exteriors only, just like WORLD_LAND, so inland-water
 * holes returned by the clipping library are omitted here as they are in the vendored source data.
 */
export function dissolveCountryRings(rings: readonly Ring[]): Ring[] {
  if (rings.length < 2) return rings.map((ring) => [...ring]);

  const polygons: Polygon[] = rings.map((ring) => [[...ring] as [number, number][]]);
  const dissolved = polygonClipping.union(polygons[0]!, ...polygons.slice(1));

  return dissolved.flatMap((polygon) => {
    const exterior = polygon[0];
    if (!exterior || exterior.length < 4) return [];
    // polygon-clipping closes every output ring; the rest of this pipeline treats closure as
    // implicit and would otherwise simplify/render the first vertex twice.
    return [exterior.slice(0, -1) as Ring];
  });
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
  const chosen = chooseMinimalLonRepresentation(rings);
  if (!chosen || !isValidCrop(chosen.bbox)) return null;
  return finalizeGeography(dissolveCountryRings(chosen.rings), chosen.bbox);
}
