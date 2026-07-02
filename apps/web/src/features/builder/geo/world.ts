import type { MapGeography } from '@trm/map-data';
import { WORLD_LAND } from './worldData';
import { buildProjection, isValidCrop, type CropBBox } from './projection';
import { clipRingsToBBox } from './clip';
import { simplifyToFit } from './simplify';

export function worldLand() {
  return WORLD_LAND;
}

export interface CropResult {
  geography: MapGeography;
  /** Land rings dropped for being too small after simplification, or over the ring cap —
   *  surfaced so the crop UI can warn rather than silently truncate. */
  droppedRings: number;
}

/** Full crop pipeline: clip the world to the bbox, simplify to fit the engine's caps
 *  (validateGeography's limits), then project into board space. Null on an invalid crop. */
export function cropToGeography(crop: CropBBox): CropResult | null {
  if (!isValidCrop(crop)) return null;
  const clipped = clipRingsToBBox(WORLD_LAND, crop);
  const { rings: simplified, droppedRings } = simplifyToFit(clipped, {
    maxVertices: 8000,
    maxRings: 200,
  });
  const { baseView, project } = buildProjection(crop);
  const land = simplified.map((ring) => ring.map(([lon, lat]) => project(lon, lat)));
  return { geography: { baseView, land, crop }, droppedRings };
}
