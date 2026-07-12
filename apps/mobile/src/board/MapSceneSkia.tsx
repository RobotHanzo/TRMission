// The single map-scene subtree — geography → routes → cities → labels — mirroring the web
// MapScene.tsx prop contract (apps/web/src/components/MapScene.tsx) minus its DOM-specific hooks, so
// the online board, the offline board (P3), and the tutorial (P4) all render THROUGH it and none can
// drift. Purely presentational: content + game state + LOD arrive as props; no stores, no i18n. This
// is a Skia <Group>, NOT its own <Canvas> — the Board (Task 5) owns the Canvas + camera transform.
import { useEffect, useMemo } from 'react';
import { Group, Path, type SkPath } from '@shopify/react-native-skia';
import { Easing, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import type { MapGeography, RouteGeometry } from '@trm/map-data';
import { seatColor } from '../theme/colors';
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

  /* ── sweep overlays (ticket completion / longest-trail reveal) ── */
  sweeps?: readonly { id: number; seat: number; path: string[] }[] | undefined;
  routeReveal?: { seat: number; path: string[] } | null | undefined;
  /** Reduced motion snaps the sweep trims to fully drawn (mirrors the web's CSS media block). */
  reducedMotion?: boolean | undefined;
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
  sweeps,
  routeReveal,
  reducedMotion,
}: MapSceneSkiaProps) {
  const model = useMemo(() => buildRouteRenderModel(routes, geometry), [routes, geometry]);
  const modelById = useMemo(() => new Map(model.map((m) => [m.id, m])), [model]);

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
      {/* Ticket-completion sweep: seat-colour glow drawn start→end along the owned path, one
          segment after another (ports the web's --delay: i*0.32s stagger). Removal timers live in
          the Board (path.length*320 + 900ms). */}
      {sweeps?.map((sw) => (
        <Group key={sw.id}>
          {sw.path.map((rid, i) => {
            const m = modelById.get(rid);
            if (!m) return null;
            return (
              <SweepSegment
                key={`${sw.id}:${rid}`}
                path={m.bed}
                color={seatColor(sw.seat)}
                width={5 * inv}
                delayMs={i * 320}
                reduced={!!reducedMotion}
              />
            );
          })}
        </Group>
      ))}
      {/* Longest-trail review: a persistent seat-colour sweep along the player's longest route
          (cleared by the scoreboard, not a timer). */}
      {routeReveal && (
        <Group>
          {routeReveal.path.map((rid, i) => {
            const m = modelById.get(rid);
            if (!m) return null;
            return (
              <SweepSegment
                key={rid}
                path={m.bed}
                color={seatColor(routeReveal.seat)}
                width={5 * inv}
                delayMs={i * 120}
                reduced={!!reducedMotion}
              />
            );
          })}
        </Group>
      )}
    </Group>
  );
}

/** One sweep segment: the route's bed path stroked in the seat colour, trim-animated 0→1 after its
 *  stagger delay (the Skia `end` prop drives the draw-on; reduced motion renders it fully drawn). */
function SweepSegment({
  path,
  color,
  width,
  delayMs,
  reduced,
}: {
  path: SkPath;
  color: string;
  width: number;
  delayMs: number;
  reduced: boolean;
}) {
  const end = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) {
      end.value = withDelay(
        delayMs,
        withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }),
      );
    }
  }, [reduced, delayMs, end]);
  return (
    <Path
      path={path}
      style="stroke"
      strokeWidth={width}
      strokeCap="round"
      color={color}
      opacity={0.95}
      start={0}
      end={end}
    />
  );
}
