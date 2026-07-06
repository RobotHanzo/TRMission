// The single map-scene subtree — geography → routes → cities → labels — mirroring the web
// MapScene.tsx prop contract (apps/web/src/components/MapScene.tsx) minus its DOM-specific hooks, so
// the online board, the offline board (P3), and the tutorial (P4) all render THROUGH it and none can
// drift. Purely presentational: content + game state + LOD arrive as props; no stores, no i18n. This
// is a Skia <Group>, NOT its own <Canvas> — the Board (Task 5) owns the Canvas + camera transform.
import { useMemo } from 'react';
import { Group } from '@shopify/react-native-skia';
import type { MapGeography, RouteGeometry } from '@trm/map-data';
import type { ZoomBucket } from './camera';
import { GeographyLayer, type BoardView } from './GeographyLayer';
import { RouteLayer } from './RouteLayer';
import { CityLayer } from './CityLayer';
import { LabelLayer } from './LabelLayer';
import { buildRouteRenderModel } from './scenePaths';

/** The minimal city/route shapes the scene needs — satisfied by the live content's branded
 *  CityDef/RouteDef and by any plain-string draft (same as the web SceneCity/SceneRoute). */
export interface SceneCity {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly isIsland?: boolean | undefined;
}
export interface SceneRoute {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly color: string;
  readonly length: number;
  readonly isTunnel?: boolean | undefined;
  readonly ferryLocos?: number | undefined;
}
/** A route's claim state (from the snapshot): owned by a seat, or locked (double sibling). */
export interface RouteOwnership {
  readonly ownerSeat?: number | undefined;
  readonly locked?: boolean | undefined;
}

export interface MapSceneSkiaProps {
  /* ── content ── */
  cities: readonly SceneCity[];
  routes: readonly SceneRoute[];
  geometry: ReadonlyMap<string, RouteGeometry>;
  hubs: ReadonlySet<string>;
  /** `null` → the hand-authored Taiwan coast; otherwise a custom map's cropped-world land. */
  geography: MapGeography | null;
  /** The scene's board-unit view (the active catalog's baseView). */
  view: BoardView;

  /* ── game state (all optional — omitted renders the plain base-colour network) ── */
  owned?: ReadonlyMap<string, RouteOwnership> | undefined;
  stations?: ReadonlyMap<string, number> | undefined;
  glowingRoutes?: ReadonlyMap<string, number> | undefined;
  glowingStations?: ReadonlyMap<string, number> | undefined;
  highlightCities?: ReadonlySet<string> | undefined;
  colorBlind?: boolean | undefined;
  showFerryLocos?: boolean | undefined;

  /* ── labels ── */
  cityLabel?: ((city: SceneCity) => string) | undefined;
  cityTier?: ((cityId: string) => string) | undefined;

  /* ── LOD inputs (quantized React state from the Board — Task 5) ── */
  bucket: ZoomBucket;
  inv: number;
  marker: number;

  /* ── sweep overlays (ticket completion / longest-trail reveal) — animated in Task 10 ── */
  sweeps?: readonly { id: number; seat: number; path: string[] }[] | undefined;
  routeReveal?: { seat: number; path: string[] } | null | undefined;
}

export function MapSceneSkia({
  cities,
  routes,
  geometry,
  hubs,
  geography,
  view,
  owned,
  stations,
  glowingRoutes,
  glowingStations,
  highlightCities,
  colorBlind,
  showFerryLocos,
  cityLabel,
  cityTier,
  bucket,
  inv,
  marker,
}: MapSceneSkiaProps) {
  const model = useMemo(() => buildRouteRenderModel(routes, geometry), [routes, geometry]);

  return (
    <Group>
      <GeographyLayer geography={geography} view={view} inv={inv} />
      <RouteLayer
        model={model}
        owned={owned}
        glowingRoutes={glowingRoutes}
        colorBlind={colorBlind}
        showFerryLocos={showFerryLocos}
        inv={inv}
      />
      <CityLayer
        cities={cities}
        hubs={hubs}
        stations={stations}
        glowingStations={glowingStations}
        highlightCities={highlightCities}
        marker={marker}
      />
      <LabelLayer
        cities={cities}
        cityLabel={cityLabel}
        cityTier={cityTier}
        bucket={bucket}
        inv={inv}
        marker={marker}
      />
      {/* Sweep / trail-reveal overlays (Task 10) draw above the cities; wired with the animation
          driver there. The props are accepted now so the Board/GameStage contract stays stable. */}
    </Group>
  );
}
