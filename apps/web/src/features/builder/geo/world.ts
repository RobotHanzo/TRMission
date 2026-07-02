import type { MapGeography } from '@trm/map-data';
import { WORLD_LAND } from './worldData';
import { isCrudeTaiwanRing, taiwanRings } from './taiwan';
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

/** Full crop pipeline: clip the world to the bbox, simplify to fit the engine's caps
 *  (validateGeography's limits), then project into board space. Null on an invalid crop. */
export function cropToGeography(crop: CropBBox): CropResult | null {
  if (!isValidCrop(crop)) return null;
  const clipped = clipRingsToBBox(WORLD_LAND_DETAILED, crop);
  const { rings: simplified, droppedRings } = simplifyToFit(clipped, {
    startTolerance: startToleranceFor(crop),
    maxVertices: 8000,
    maxRings: 200,
  });
  const { baseView, project } = buildProjection(crop);
  const land = simplified.map((ring) => ring.map(([lon, lat]) => project(lon, lat)));
  return { geography: { baseView, land, crop }, droppedRings };
}
