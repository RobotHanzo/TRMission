// The native Board.tsx — ports apps/web/src/components/Board.tsx's game orchestration (camera
// follow + broadcast, the visibility-gated claim glow, spotlight/reveal auto-framing, controls)
// onto the Skia scene + useBoardCamera. The web needed pixel↔board projection bridging for all of
// this; here the camera IS the board-space view descriptor, so every framing consumes/produces
// {cx, cy, span} directly. Purely snapshot-driven: no store writes besides the animation expiries.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Canvas, Group } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import type { GameSnapshot } from '@trm/proto';
import { MAP_PALETTE_DARK, MAP_PALETTE_LIGHT } from '@trm/map-data';
import { CITIES, ROUTES, cityById, cityName, routeById } from '../game/content';
import { boardEventOverlays } from '../game/events';
import { HUB_CITIES, ROUTE_GEOMETRY } from '../game/routeGeometry';
import { brokenRailMap, canClaimBrokenRail, myId, ownershipMap } from '../game/view';
import { cityTier } from '../game/lod';
import { ACTIVE_BASE_VIEW, ACTIVE_GEOGRAPHY } from '../game/catalog';
import { getSocket } from '../net/connection';
import { useGameStore } from '../store/game';
import { useAnimationsStore } from '../store/animations';
import { useUi } from '../store/ui';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useTheme } from '../theme/useTheme';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../features/tutorial/targets';
import { registerBoardCameraSource } from '../features/tutorial/cameraBridge';
import type { Locale } from '../net/rest';
import { frameDurationMs, type BoardFrameTarget } from './frameTarget';
import {
  BOT_FOLLOW_SPAN,
  boundsOfContent,
  homeCamera,
  pinchTo,
  rasterSpec,
  visibleFraction,
  type Bounds,
  type CameraState,
  type Viewport,
} from './camera';
import { buildHitScene, hitTest } from './hitTest';
import { latestActionPoi, shouldDisengageFollow } from './followModel';
import { useBoardCamera, type BoardCamera } from './useBoardCamera';
import { MapSceneSkia, SCENE_OVERSCAN } from './MapSceneSkia';
import { BoardControls } from './BoardControls';

/** A claimed route glows for this long once it actually comes into view. */
const GLOW_MS = 1300;
/** Drop an armed glow that never reaches half-visibility within this window (claim never seen). */
const GLOW_WAIT_MS = 2600;
/** The glow fires once at least this fraction of the route's cars sit inside the viewport. */
const GLOW_VISIBLE_FRACTION = 0.5;

export interface BoardViewProps {
  snapshot: GameSnapshot;
  locale: Locale;
  colorBlind: boolean;
  /** Route taps resolve only while true. Split from `canBuildStation` so the tutorial can gate
   *  claiming and station-building independently (a CLAIM_ROUTE beat must not leave cities live). */
  canClaim: boolean;
  /** City taps resolve only while true. */
  canBuildStation: boolean;
  onPickRoute(routeId: string): void;
  onPickCity(cityId: string): void;
  /** Cities to softly highlight (the offered tickets' endpoints, while choosing tickets). */
  highlightCities?: ReadonlySet<string> | undefined;
  /** Sandbox (tutorial/offline): suppress the live camera broadcast + follow. */
  sandbox?: boolean | undefined;
  /** Tutorial auto-pan: frame these routes/cities. Null/undefined leaves the camera alone. */
  frameTarget?: BoardFrameTarget | null | undefined;
}

/** Measures itself, then mounts the camera-carrying inner board — the camera's shared values
 *  seed from the home framing, which needs a real viewport before the first render. */
export function BoardView(props: BoardViewProps): React.JSX.Element {
  const [vp, setVp] = useState<Viewport | null>(null);
  const { dark } = useTheme();
  // The tutorial spotlights the whole board through this container (web `.board-viewport`).
  const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.board);
  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    setVp((prev) =>
      prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
    );
  };
  return (
    <View
      {...anchor}
      style={[
        styles.viewport,
        { backgroundColor: (dark ? MAP_PALETTE_DARK : MAP_PALETTE_LIGHT).sea },
      ]}
      onLayout={onLayout}
    >
      {vp && vp.w > 0 && vp.h > 0 ? <BoardInner {...props} vp={vp} /> : null}
    </View>
  );
}

/** Board coordinate frame that contains `cityIds` with padding — the shared span/centre maths of
 *  the web RevealFramer + SpotlightFramer (identical numbers, factored once). */
function frameCameraForCities(cityIds: readonly string[]): CameraState | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cid of cityIds) {
    const c = cityById.get(cid);
    if (!c) continue;
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  if (!Number.isFinite(minX)) return null;
  const span = Math.min(100, Math.max(22, Math.max(maxX - minX, maxY - minY) + 16));
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span };
}

const routeEndpoints = (rid: string): string[] => {
  const r = routeById.get(rid);
  return r ? [r.a as string, r.b as string] : [];
};

/**
 * "Follow the acting player" (ports the web CameraSync). While it is MY turn it broadcasts my
 * framing at ≈12 Hz (the camera state IS the wire descriptor — no projection); while another HUMAN
 * acts it mirrors their relayed framing; while a BOT acts it glides to the POI of each action. A
 * manual gesture disarms the toggle elsewhere, so this never fights the user.
 */
function CameraSync({ snapshot, cam }: { snapshot: GameSnapshot; cam: BoardCamera }): null {
  const followActing = useUi((s) => s.followActing);
  const actingCamera = useGameStore((s) => s.actingCamera);
  const recentEvents = useGameStore((s) => s.recentEvents);

  const me = snapshot.you?.playerId ?? null;
  const current = snapshot.currentPlayerId;
  const myTurn = !!me && current === me;
  const currentIsBot = current.startsWith('bot:');
  const { animateTo, currentCamera } = cam;

  // ── Broadcast my framing while it's my turn (≈12 Hz, and only when it actually moves) ──
  useEffect(() => {
    if (!myTurn) return;
    let last: CameraState | null = null;
    const tick = (): void => {
      const socket = getSocket();
      if (!socket) return;
      const view = currentCamera();
      if (
        last &&
        Math.abs(last.cx - view.cx) < 0.05 &&
        Math.abs(last.cy - view.cy) < 0.05 &&
        Math.abs(last.span - view.span) < 0.05
      )
        return;
      last = view;
      socket.cameraUpdate(view);
    };
    tick(); // one frame immediately so a follower sees where I start
    const id = setInterval(tick, 80);
    return () => clearInterval(id);
  }, [myTurn, currentCamera]);

  // ── Follow a HUMAN actor: mirror their relayed framing as it streams in ──
  useEffect(() => {
    if (!followActing || myTurn || currentIsBot) return;
    if (!actingCamera || actingCamera.playerId !== current) return;
    animateTo(actingCamera.view, 150);
  }, [followActing, myTurn, currentIsBot, current, actingCamera, animateTo]);

  // ── Follow a BOT actor: glide to the POI of each NEW spatial action ──
  const lastPoiKey = useRef<string | null>(null);
  useEffect(() => {
    if (!followActing || myTurn || !currentIsBot) {
      lastPoiKey.current = null;
      return;
    }
    const poi = latestActionPoi(recentEvents, current);
    if (!poi || poi.key === lastPoiKey.current) return;
    lastPoiKey.current = poi.key;
    animateTo({ cx: poi.x, cy: poi.y, span: BOT_FOLLOW_SPAN }, 600);
  }, [followActing, myTurn, currentIsBot, current, recentEvents, animateTo]);

  return null;
}

/**
 * Gates the route-claim glow on visibility (ports the web RouteGlowGate). A freshly-claimed route
 * is "armed" the instant the event lands, but its glow only STARTS once at least half its cars are
 * within the viewport — so when the follow-camera is mid-pan toward a bot's claim the highlight
 * waits for the railway to arrive on screen rather than flashing while it's still off in a corner.
 * The web re-tested on every pan/zoom frame via useTransformEffect; here an animated reaction on
 * the camera transform wakes the JS thread only while something is armed.
 */
function RouteGlowGate({
  armed,
  started,
  onStart,
  cam,
  vp,
}: {
  armed: ReadonlyMap<string, number>;
  started: ReadonlyMap<string, number>;
  onStart(routeId: string, seat: number): void;
  cam: BoardCamera;
  vp: Viewport;
}): null {
  const startedRef = useRef(started);
  startedRef.current = started;

  // Held in a ref so the reaction and the armed-change effect call the same closure without
  // either needing the other's deps.
  const evaluate = useRef<() => void>(() => {});
  evaluate.current = (): void => {
    if (armed.size === 0) return;
    for (const [routeId, seat] of armed) {
      if (startedRef.current.has(routeId)) continue;
      const g = ROUTE_GEOMETRY.get(routeId);
      // No geometry to test → start it immediately; otherwise wait until it's half in view.
      if (!g || visibleFraction(g.slots, cam.currentCamera(), vp) >= GLOW_VISIBLE_FRACTION) {
        onStart(routeId, seat);
      }
    }
  };
  const runEvaluate = useCallback(() => evaluate.current(), []);

  // Re-check as the camera moves (a follow-pan promotes the route as it slides into view)…
  const armedActive = armed.size > 0;
  useAnimatedReaction(
    () => (armedActive ? cam.transform.value : null),
    (v) => {
      if (v !== null) runOnJS(runEvaluate)();
    },
    [armedActive, cam.transform, runEvaluate],
  );
  // …and whenever the armed set changes (a claim made while the route is already on screen).
  useEffect(() => {
    evaluate.current();
  }, [armed]);

  return null;
}

/** Frames the board on the longest-trail route reveal (ports the web RevealFramer). */
function RevealFramer({ cam }: { cam: BoardCamera }): null {
  const reveal = useAnimationsStore((s) => s.routeReveal);
  const { animateTo } = cam;
  useEffect(() => {
    if (!reveal || reveal.path.length === 0) return;
    const target = frameCameraForCities(reveal.path.flatMap(routeEndpoints));
    if (target) animateTo(target, 500);
  }, [reveal, animateTo]);
  return null;
}

/** Auto-pan framer (ports the web SpotlightFramer): frames a set of routes/cities. Driven by the
 *  tutorial/replay `frameTarget` prop when present; else the live game's `eventSpotlight`. */
function SpotlightFramer({
  cam,
  target,
}: {
  cam: BoardCamera;
  target: BoardFrameTarget | null | undefined;
}): null {
  const reduced = useReducedMotion();
  const eventSpotlight = useAnimationsStore((s) => s.eventSpotlight);
  const effective = target ?? eventSpotlight;
  const key = effective ? `${effective.kind}:${effective.ids.join(',')}` : '';
  const { animateTo } = cam;
  useEffect(() => {
    if (!effective || effective.ids.length === 0) return;
    const cityIds =
      effective.kind === 'route' ? effective.ids.flatMap(routeEndpoints) : effective.ids;
    const to = frameCameraForCities(cityIds);
    if (to) animateTo(to, frameDurationMs(effective, reduced));
  }, [key, effective, reduced, animateTo]);
  return null;
}

function BoardInner({
  snapshot,
  locale,
  colorBlind,
  canClaim,
  canBuildStation,
  onPickRoute,
  onPickCity,
  highlightCities,
  sandbox,
  frameTarget,
  vp,
}: BoardViewProps & { vp: Viewport }): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  // Themed cartography: the dark board palette follows the app theme (web tokens.css parity).
  const { dark } = useTheme();
  const palette = dark ? MAP_PALETTE_DARK : MAP_PALETTE_LIGHT;
  // ── Derivations from the snapshot (ports Board.tsx's pure useMemos) ──
  const owned = useMemo(() => ownershipMap(snapshot), [snapshot]);
  const brokenRails = useMemo(() => brokenRailMap(snapshot), [snapshot]);
  const repairedRoutes = useMemo(() => new Set(brokenRails.keys()), [brokenRails]);
  const stationCities = useMemo(() => {
    const seats = new Map(snapshot.players.map((p) => [p.id, p.seat]));
    return new Map(snapshot.stations.map((s) => [s.cityId, seats.get(s.playerId) ?? 0]));
  }, [snapshot]);
  // The full random-events board projection (shared with the web Board via client-core). A
  // closed route (typhoon landfall / slope repair order) can't be claimed (the server rejects
  // it) → not tappable either; everything else renders through MapSceneSkia's EventOverlayLayer.
  const events = useMemo(() => boardEventOverlays(snapshot.randomEvents), [snapshot]);
  const closedRoutes = events.closedRoutes;

  // The active catalog is stable while a board is mounted (screens gate on useActiveContent
  // readiness before rendering), so content-derived structures build once.
  const contentBounds = useMemo(
    () => boundsOfContent({ cities: CITIES, geography: ACTIVE_GEOGRAPHY }),
    [],
  );
  const scene = useMemo(() => buildHitScene(CITIES, ROUTES, ROUTE_GEOMETRY), []);
  const home = useMemo(() => homeCamera(contentBounds, vp), [contentBounds, vp]);

  // Latest-value refs so the gesture callbacks stay identity-stable (the composed gesture only
  // rebuilds on viewport/content changes, not every snapshot render).
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canClaimRef = useRef(canClaim);
  canClaimRef.current = canClaim;
  const canBuildStationRef = useRef(canBuildStation);
  canBuildStationRef.current = canBuildStation;
  const ownedRef = useRef(owned);
  ownedRef.current = owned;
  const closedRef = useRef(closedRoutes);
  closedRef.current = closedRoutes;
  const brokenRailsRef = useRef(brokenRails);
  brokenRailsRef.current = brokenRails;
  const sandboxRef = useRef(sandbox);
  sandboxRef.current = sandbox;
  const onPickRouteRef = useRef(onPickRoute);
  onPickRouteRef.current = onPickRoute;
  const onPickCityRef = useRef(onPickCity);
  onPickCityRef.current = onPickCity;

  // A real user gesture (or a control button) takes back the camera — unless it's my own turn
  // (my camera IS the broadcast source; see followModel). A sandbox board never disarms the
  // LIVE game's follow toggle.
  const onManualCamera = useCallback(() => {
    if (sandboxRef.current) return;
    const snap = snapshotRef.current;
    const myTurn = !!snap.you?.playerId && snap.currentPlayerId === snap.you.playerId;
    if (shouldDisengageFollow(useUi.getState().followActing, myTurn)) {
      void useUi.getState().setFollowActing(false);
    }
  }, []);

  // Tap → manual hit-test → pick handlers. Ports MapScene's claimable gate + Board's claimFilter:
  // routes resolve only while the viewer can claim and the route is still open + unclaimed;
  // cities only while station-building is live (the two are gated independently — tutorial).
  const onTap = useCallback(
    (screen: { x: number; y: number }, tapCam: CameraState) => {
      if (!canClaimRef.current && !canBuildStationRef.current) return;
      const hit = hitTest(screen, tapCam, vp, scene);
      if (!hit) return;
      if (hit.kind === 'city') {
        if (canBuildStationRef.current) onPickCityRef.current(hit.id);
        return;
      }
      if (!canClaimRef.current || closedRef.current.has(hit.id) || ownedRef.current.has(hit.id)) {
        return;
      }
      // A broken rail stays tappable while unrepaired (the tap opens the REPAIR flow); once
      // repaired it is claim-gated to the repairer during their exclusivity window (ports the
      // web Board's claimFilter).
      const def = routeById.get(hit.id);
      if (def && (def.brokenCarriages ?? 0) > 0) {
        const info = brokenRailsRef.current.get(hit.id);
        if (info && !canClaimBrokenRail(info, myId(snapshotRef.current))) return;
      }
      onPickRouteRef.current(hit.id);
    },
    [vp, scene],
  );

  const camOpts = useMemo(() => ({ onTap, onGesture: onManualCamera }), [onTap, onManualCamera]);
  const cam = useBoardCamera(vp, ACTIVE_BASE_VIEW, home, camOpts);

  // The gesture-time raster snapshot's region + resolution, re-derived at every camera settle
  // (cam.settled only changes identity when the camera actually moved). The scene bounds match
  // MapSceneSkia's picture bounds exactly, so the snapshot never covers un-drawn space.
  const sceneBounds = useMemo<Bounds>(
    () => ({
      x: ACTIVE_BASE_VIEW.x - SCENE_OVERSCAN,
      y: ACTIVE_BASE_VIEW.y - SCENE_OVERSCAN,
      w: ACTIVE_BASE_VIEW.w + SCENE_OVERSCAN * 2,
      h: ACTIVE_BASE_VIEW.h + SCENE_OVERSCAN * 2,
    }),
    [],
  );
  const raster = useMemo(
    () => rasterSpec(cam.settled, vp, sceneBounds, PixelRatio.get()),
    [cam.settled, vp, sceneBounds],
  );

  // Publish the live camera to the tutorial's spotlight bridge while this board is mounted
  // (unconditional — the tutorial runs in sandbox mode, where CameraSync never mounts).
  const { currentCamera } = cam;
  useEffect(
    () => registerBoardCameraSource(() => ({ camera: currentCamera(), vp })),
    [currentCamera, vp],
  );

  // ── Claim glow: armed (store) → started (visible) → cleared (ports Board.tsx's timers) ──
  const armedGlowRoutes = useAnimationsStore((s) => s.glowingRoutes);
  const glowingStations = useAnimationsStore((s) => s.glowingStations);
  const sweeps = useAnimationsStore((s) => s.sweeps);
  const routeReveal = useAnimationsStore((s) => s.routeReveal);
  const clearGlowRoute = useAnimationsStore((s) => s.clearGlowRoute);
  const clearGlowStation = useAnimationsStore((s) => s.clearGlowStation);
  const removeSweep = useAnimationsStore((s) => s.removeSweep);

  const [startedGlowRoutes, setStartedGlowRoutes] = useState<Map<string, number>>(new Map());
  const startedGlowRef = useRef(startedGlowRoutes);
  startedGlowRef.current = startedGlowRoutes;
  const startGlow = useCallback((routeId: string, seat: number) => {
    setStartedGlowRoutes((m) => (m.has(routeId) ? m : new Map(m).set(routeId, seat)));
  }, []);

  // Once a route's glow STARTS (it came into view), run it for GLOW_MS then clear local + store.
  // Each route schedules exactly one clear (guarded by the ref) so a re-render never resets it.
  const glowClearTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const id of startedGlowRoutes.keys()) {
      if (glowClearTimers.current.has(id)) continue;
      const tid = setTimeout(() => {
        glowClearTimers.current.delete(id);
        setStartedGlowRoutes((m) => {
          if (!m.has(id)) return m;
          const n = new Map(m);
          n.delete(id);
          return n;
        });
        clearGlowRoute(id);
      }, GLOW_MS);
      glowClearTimers.current.set(id, tid);
    }
  }, [startedGlowRoutes, clearGlowRoute]);

  // An armed route that never reaches half-visibility within the grace window (e.g. a bot's claim
  // while not following) is dropped unseen, so it neither glows late nor piles up in the store.
  const glowWaitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const id of armedGlowRoutes.keys()) {
      if (glowWaitTimers.current.has(id)) continue;
      const tid = setTimeout(() => {
        glowWaitTimers.current.delete(id);
        if (!startedGlowRef.current.has(id)) clearGlowRoute(id);
      }, GLOW_WAIT_MS);
      glowWaitTimers.current.set(id, tid);
    }
    for (const id of [...glowWaitTimers.current.keys()]) {
      if (!armedGlowRoutes.has(id)) {
        const tid = glowWaitTimers.current.get(id);
        if (tid !== undefined) clearTimeout(tid);
        glowWaitTimers.current.delete(id);
      }
    }
  }, [armedGlowRoutes, clearGlowRoute]);

  // Tidy any still-pending glow timers on unmount.
  useEffect(
    () => () => {
      for (const tid of glowClearTimers.current.values()) clearTimeout(tid);
      for (const tid of glowWaitTimers.current.values()) clearTimeout(tid);
    },
    [],
  );

  useEffect(() => {
    if (glowingStations.size === 0) return;
    const timers = [...glowingStations.keys()].map((id) =>
      setTimeout(() => clearGlowStation(id), 1100),
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [glowingStations, clearGlowStation]);
  useEffect(() => {
    if (sweeps.length === 0) return;
    const timers = sweeps.map((sw) =>
      setTimeout(() => removeSweep(sw.id), sw.path.length * 320 + 900),
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [sweeps, removeSweep]);

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={cam.gesture}>
        <Canvas style={styles.fill}>
          <Group transform={cam.transform}>
            <MapSceneSkia
              cities={CITIES}
              routes={ROUTES}
              geometry={ROUTE_GEOMETRY}
              hubs={HUB_CITIES}
              geography={ACTIVE_GEOGRAPHY}
              view={ACTIVE_BASE_VIEW}
              owned={owned}
              stations={stationCities}
              glowingRoutes={startedGlowRoutes}
              glowingStations={glowingStations}
              highlightCities={highlightCities}
              colorBlind={colorBlind}
              repairedRoutes={repairedRoutes}
              cityLabel={(c) => cityName(c.id, locale)}
              cityTier={cityTier}
              bucket={cam.lod.bucket}
              inv={cam.lod.inv}
              marker={cam.lod.marker}
              palette={palette}
              events={snapshot.randomEvents ? events : undefined}
              sweeps={sweeps}
              routeReveal={routeReveal}
              reducedMotion={reducedMotion}
              motionSV={cam.movingSV}
              zoomingSV={cam.zoomingSV}
              raster={raster}
            />
          </Group>
        </Canvas>
      </GestureDetector>

      {!sandbox && <CameraSync snapshot={snapshot} cam={cam} />}
      <RevealFramer cam={cam} />
      <SpotlightFramer cam={cam} target={frameTarget ?? null} />
      <RouteGlowGate
        armed={armedGlowRoutes}
        started={startedGlowRoutes}
        onStart={startGlow}
        cam={cam}
        vp={vp}
      />
      <BoardControls
        onZoom={(factor) =>
          cam.animateTo(
            pinchTo(
              cam.currentCamera(),
              { x: vp.w / 2, y: vp.h / 2 },
              factor,
              vp,
              ACTIVE_BASE_VIEW,
            ),
            180,
          )
        }
        onReset={() => cam.animateTo(homeCamera(contentBounds, vp), 200)}
        onManualCamera={onManualCamera}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1 },
  fill: { flex: 1 },
});
