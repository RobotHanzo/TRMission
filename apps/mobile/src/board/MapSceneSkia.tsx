// The single map-scene subtree — geography → routes → cities → labels — mirroring the web
// MapScene.tsx prop contract (apps/web/src/components/MapScene.tsx) minus its DOM-specific hooks, so
// the online board, the offline board (P3), and the tutorial (P4) all render THROUGH it and none can
// drift. Purely presentational: content + game state + LOD arrive as props; no stores, no i18n. This
// is a Skia <Group>, NOT its own <Canvas> — the Board (Task 5) owns the Canvas + camera transform.
import { useEffect, useMemo } from 'react';
import {
  Circle as SkiaCircle,
  FilterMode,
  Group,
  Image as SkiaImage,
  MipmapMode,
  Path,
  Picture,
  type SkPath,
  type SkRect,
} from '@shopify/react-native-skia';
import {
  Easing,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { MAP_DIMS, type MapGeography, type RouteGeometry } from '@trm/map-data';
import { seatColor } from '../theme/colors';
import type { RasterSpec, ZoomBucket } from './camera';
import { GeographyLayer, type BoardView } from './GeographyLayer';
import { RouteLayer } from './RouteLayer';
import { CityLayer } from './CityLayer';
import { LabelLayer } from './LabelLayer';
import { buildRouteRenderModel, type RouteRenderModel } from './scenePaths';
import { useStaticMapImage, useStaticMapPicture } from './useStaticMapPicture';

/** Board units of sea drawn beyond the base view on every side, so panning never shows an edge.
 *  Shared with BoardView's raster-region clamp — the snapshot never covers more than the scene. */
export const SCENE_OVERSCAN = 40;

// Mip-mapped sampling stops the snapshot shimmering while a pinch-out minifies it. The enums are
// absent from the jest mock (where no snapshot is ever produced) — guarded like everything Skia.
const RASTER_SAMPLING = (FilterMode as unknown)
  ? { filter: FilterMode.Linear, mipmap: MipmapMode.Linear }
  : undefined;

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

  /* ── gesture-time raster snapshot (see useStaticMapImage) ── */
  /** TRUE while the camera is moving — draw the rasterized snapshot instead of the vectors. */
  motion?: boolean | undefined;
  /** Snapshot region + resolution for the settled camera (camera.ts rasterSpec). Omitted (the
   *  tutorial specimens, tests) the scene simply always draws vectors. */
  raster?: RasterSpec | null | undefined;
}

/** The board's static layers — everything that doesn't animate on its own. Factored out so it can
 *  be recorded once into a cached Picture (see useStaticMapPicture) instead of replayed shape-by-
 *  shape on every camera frame; the sweep/reveal overlays below stay live JSX since they genuinely
 *  animate every frame on their own timers. */
interface MapSceneStaticProps {
  model: readonly RouteRenderModel[];
  cities: readonly SceneCity[];
  hubs: ReadonlySet<string>;
  geography: MapGeography | null;
  view: BoardView;
  owned?: ReadonlyMap<string, RouteOwnership> | undefined;
  stations?: ReadonlyMap<string, number> | undefined;
  highlightCities?: ReadonlySet<string> | undefined;
  colorBlind?: boolean | undefined;
  showFerryLocos?: boolean | undefined;
  cityLabel?: ((city: SceneCity) => string) | undefined;
  cityTier?: ((cityId: string) => string) | undefined;
  bucket: ZoomBucket;
  inv: number;
  marker: number;
}

function MapSceneStatic({
  model,
  cities,
  hubs,
  geography,
  view,
  owned,
  stations,
  highlightCities,
  colorBlind,
  showFerryLocos,
  cityLabel,
  cityTier,
  bucket,
  inv,
  marker,
}: MapSceneStaticProps) {
  return (
    <Group>
      <GeographyLayer geography={geography} view={view} inv={inv} />
      <RouteLayer
        model={model}
        owned={owned}
        colorBlind={colorBlind}
        showFerryLocos={showFerryLocos}
        inv={inv}
      />
      <CityLayer
        cities={cities}
        hubs={hubs}
        stations={stations}
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
    </Group>
  );
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
  motion,
  raster,
}: MapSceneSkiaProps) {
  const model = useMemo(() => buildRouteRenderModel(routes, geometry), [routes, geometry]);
  const modelById = useMemo(() => new Map(model.map((m) => [m.id, m])), [model]);
  const cityById = useMemo(() => new Map(cities.map((c) => [c.id, c])), [cities]);

  const staticElement = useMemo(
    () => (
      <MapSceneStatic
        model={model}
        cities={cities}
        hubs={hubs}
        geography={geography}
        view={view}
        owned={owned}
        stations={stations}
        highlightCities={highlightCities}
        colorBlind={colorBlind}
        showFerryLocos={showFerryLocos}
        cityLabel={cityLabel}
        cityTier={cityTier}
        bucket={bucket}
        inv={inv}
        marker={marker}
      />
    ),
    [
      model,
      cities,
      hubs,
      geography,
      view,
      owned,
      stations,
      highlightCities,
      colorBlind,
      showFerryLocos,
      cityLabel,
      cityTier,
      bucket,
      inv,
      marker,
    ],
  );
  const bounds = useMemo<SkRect>(
    () => ({
      x: view.x - SCENE_OVERSCAN,
      y: view.y - SCENE_OVERSCAN,
      width: view.w + SCENE_OVERSCAN * 2,
      height: view.h + SCENE_OVERSCAN * 2,
    }),
    [view.x, view.y, view.w, view.h],
  );
  const picture = useStaticMapPicture(staticElement, bounds, [staticElement, bounds]);
  const snapshot = useStaticMapImage(picture, raster);

  // The snapshot draws UNDER the vectors at rest (fully hidden — the picture's sea rect is opaque
  // and covers the whole scene) so its GPU texture stays uploaded/warm, then carries the frame
  // alone while the camera moves. No snapshot yet (first record still in flight, or an
  // environment without offscreen surfaces) → the vectors keep drawing through motion as before.
  const snapshotElement = snapshot ? (
    <SkiaImage
      image={snapshot.image}
      x={snapshot.rect.x}
      y={snapshot.rect.y}
      width={snapshot.rect.w}
      height={snapshot.rect.h}
      fit="fill"
      sampling={RASTER_SAMPLING}
    />
  ) : null;

  return (
    <Group>
      {snapshotElement}
      {motion && snapshotElement ? null : picture ? <Picture picture={picture} /> : staticElement}
      {/* Claim glow: the just-claimed route blooms in the owner's seat colour then settles (web
          `.route.just-claimed`, anim-glow-bloom 1.2s). Live JSX — deliberately OUTSIDE the cached
          Picture, so arming/clearing a glow animates without re-recording the static scene. */}
      {glowingRoutes &&
        [...glowingRoutes].map(([rid, seat]) => {
          const m = modelById.get(rid);
          if (!m) return null;
          return (
            <Group
              key={`glow:${rid}`}
              transform={[{ translateX: m.perp.x * inv }, { translateY: m.perp.y * inv }]}
            >
              <GlowBloom
                path={m.bed}
                color={seatColor(seat)}
                width={MAP_DIMS.bedOwnedW * 2.4 * inv}
                reduced={!!reducedMotion}
              />
            </Group>
          );
        })}
      {/* Station build: a radiating seat-colour ring pops out of the city, then a sustained halo
          holds until the store clears it (web anim-station-pop + .station-ring, 0.9s). */}
      {glowingStations &&
        [...glowingStations].map(([cid, seat]) => {
          const c = cityById.get(cid);
          if (!c) return null;
          return (
            <StationPop
              key={`pop:${cid}`}
              cx={c.x}
              cy={c.y}
              baseR={MAP_DIMS.cityR * marker}
              strokeW={0.3 * marker}
              color={seatColor(seat)}
              reduced={!!reducedMotion}
            />
          );
        })}
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

/** The claim glow's bloom: flare bright over the route, then settle to the sustained halo the
 *  glow holds until the Board's GLOW_MS timer clears it (web anim-glow-bloom's brightness spike
 *  at 35%). Reduced motion renders the sustained halo directly. */
function GlowBloom({
  path,
  color,
  width,
  reduced,
}: {
  path: SkPath;
  color: string;
  width: number;
  reduced: boolean;
}) {
  const opacity = useSharedValue(reduced ? 0.3 : 0);
  useEffect(() => {
    if (!reduced) {
      opacity.value = withSequence(
        withTiming(0.55, { duration: 420, easing: Easing.out(Easing.cubic) }),
        withTiming(0.3, { duration: 780, easing: Easing.out(Easing.cubic) }),
      );
    }
  }, [reduced, opacity]);
  return (
    <Path
      path={path}
      style="stroke"
      strokeWidth={width}
      strokeCap="round"
      color={color}
      opacity={opacity}
    />
  );
}

/** The station-build pop: a ring radiates outward and fades (web .station-ring) while the
 *  sustained halo pops in with overshoot and holds (web anim-station-pop's 1.35→1 settle).
 *  Reduced motion renders the sustained halo directly, no radiating ring. */
function StationPop({
  cx,
  cy,
  baseR,
  strokeW,
  color,
  reduced,
}: {
  cx: number;
  cy: number;
  baseR: number;
  strokeW: number;
  color: string;
  reduced: boolean;
}) {
  const haloR = useSharedValue(reduced ? baseR * 1.7 : baseR * 0.4);
  const ringR = useSharedValue(baseR * 0.4);
  const ringO = useSharedValue(reduced ? 0 : 0.7);
  useEffect(() => {
    if (reduced) return;
    haloR.value = withSequence(
      withTiming(baseR * 2.2, { duration: 540, easing: Easing.out(Easing.cubic) }),
      withTiming(baseR * 1.7, { duration: 360, easing: Easing.inOut(Easing.cubic) }),
    );
    ringR.value = withTiming(baseR * 3, { duration: 900, easing: Easing.out(Easing.cubic) });
    ringO.value = withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [reduced, baseR, haloR, ringR, ringO]);
  return (
    <Group>
      <SkiaCircle
        cx={cx}
        cy={cy}
        r={ringR}
        style="stroke"
        strokeWidth={strokeW}
        color={color}
        opacity={ringO}
      />
      <SkiaCircle
        cx={cx}
        cy={cy}
        r={haloR}
        style="stroke"
        strokeWidth={strokeW}
        color={color}
        opacity={0.7}
      />
    </Group>
  );
}
