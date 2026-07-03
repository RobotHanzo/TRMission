// Route cartography for the ACTIVE content. The pure curve/bow/hub/slot math lives in
// @trm/map-data's geometry module (shared verbatim with the map builder's draft canvas and
// the server's shared-map social cards, so none of them can drift from the board); this
// module re-exports it and binds the content singletons the live board renders from.
import { buildRouteGeometryFor, computeHubsFor } from '@trm/map-data';
import type { RouteGeometry } from '@trm/map-data';
import { CITIES, ROUTES } from './content';

export {
  buildRouteGeometryFor,
  straightRouteGeometry,
  HUB_MIN_DEGREE,
  STRAIGHT_PITCH,
} from '@trm/map-data';
export type { GeometryCity, GeometryRoute, RouteGeometry, Slot } from '@trm/map-data';

/** Set of hub city ids for the active content — rebuilt by rebuildRouteGeometry() on a map swap. */
export let HUB_CITIES: ReadonlySet<string> = computeHubsFor(CITIES, ROUTES);

/** Geometry for the active content. Precomputed once for the default (Taiwan); rebuilt whenever
 *  game/catalog.ts swaps the active map (rebuildRouteGeometry() re-reads CITIES/ROUTES/cityById,
 *  which by then already point at the new content — see content.ts's applyContentTables). */
export let ROUTE_GEOMETRY: Map<string, RouteGeometry> = buildRouteGeometryFor(
  CITIES,
  ROUTES,
).geometry;

/** Recompute HUB_CITIES/ROUTE_GEOMETRY from the current CITIES/ROUTES/cityById in content.ts. */
export function rebuildRouteGeometry(): void {
  const { geometry, hubs } = buildRouteGeometryFor(CITIES, ROUTES);
  HUB_CITIES = hubs;
  ROUTE_GEOMETRY = geometry;
}
