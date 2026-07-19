// The board camera as a reusable hook: the spike's device-proven pan/pinch/tap gestures promoted
// to a Reanimated shared-value camera ({cx, cy, span}), plus the quantized LOD state (bucket / inv /
// marker) MapSceneSkia needs to counter-scale track weight, labels, and markers. The Skia Group
// transform is a derived value (UI thread); LOD is discrete React state recomputed on the JS thread
// only when the camera SETTLES — while a gesture or programmatic glide is in flight the JS thread
// does nothing at all (no LOD steps, no re-renders, no picture re-records), which is what keeps the
// pinch from drowning the JS thread. `moving`/`settled` let the Board swap the static scene to its
// rasterized snapshot for the duration of the motion (see camera.ts rasterSpec). `snapshotCam`
// rides the SAME mid-gesture LOD-requantize cadence (MID_GESTURE_LOD_RATIO) to also refresh that
// raster snapshot WHILE a pinch is in flight, not just at settle — so zoom gets the cheap-texture
// treatment pan already gets, instead of redrawing the full vector scene every frame. `settled`
// and `zoomingSV` are untouched (BoardCanvas.web.tsx depends on their exact settle-only cadence).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture, type ComposedGesture } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import type { Transforms3d } from '@shopify/react-native-skia';
import {
  clampSpan,
  invScale,
  markerScale,
  pinchTo,
  webScaleEquiv,
  zoomBucket,
  type Bounds,
  type CameraState,
  type Viewport,
  type ZoomBucket,
} from './camera';

/** Slack past a programmatic glide's duration before the camera counts as settled — covers the
 *  timing curve's tail plus a couple of frames of scheduling. */
const ANIMATE_SETTLE_SLACK_MS = 120;

/** Mid-gesture LOD cadence, as a span RATIO between JS recomputes: while a zoom is in flight the
 *  LOD (inv/marker/bucket) re-quantizes every time the span drifts this factor past the last
 *  computed value — a handful of re-records per pinch, so weights and label tiers track the zoom
 *  near-continuously without per-frame JS work. */
const MID_GESTURE_LOD_RATIO = 1.12;

/** A wheel-zoom burst counts as ONE motion: it settles this long after the last tick, so the
 *  crisp settle redraw lands right after the scroll stops instead of once per notch. */
const WHEEL_SETTLE_MS = 160;

export interface BoardLod {
  bucket: ZoomBucket;
  /** Track-weight / label counter-scale (web --inv-scale). */
  inv: number;
  /** Marker growth (web --marker-scale). */
  marker: number;
}

export interface BoardCamera {
  /** Reanimated transform for the Skia board <Group> (UI thread). */
  transform: DerivedValue<Transforms3d>;
  /** Composed pan + pinch + tap + double-tap gesture. */
  gesture: ComposedGesture;
  /** Quantized zoom state driving MapSceneSkia's counter-scaling. */
  lod: BoardLod;
  /** TRUE while a gesture or programmatic glide is moving the camera (React state — flips only
   *  at motion boundaries, never per frame). */
  moving: boolean;
  /** UI-thread mirror of `moving` (set at motion boundaries, readable per frame in worklets). */
  movingSV: SharedValue<boolean>;
  /** TRUE once the span has changed during the CURRENT motion (a pinch or a zooming glide) —
   *  the scene draws crisp vectors instead of the settled-camera raster while this is set.
   *  Cleared when the motion settles. */
  zoomingSV: SharedValue<boolean>;
  /** The camera at the last settle (mount, gesture end, or glide end) — consumed by
   *  BoardCanvas.web.tsx's own settle-only repaint strategy. Do not repurpose. */
  settled: CameraState;
  /** The camera the gesture-time raster snapshot should be rendered for (camera.ts rasterSpec):
   *  updates at settle exactly like `settled`, but ALSO at each mid-gesture LOD-requantize
   *  checkpoint during a pinch, so the snapshot backing zoom stays within MID_GESTURE_LOD_RATIO
   *  of the live camera instead of only refreshing once the gesture fully ends. */
  snapshotCam: CameraState;
  /** Ease the camera to a target over `ms` (programmatic — never disengages follow). */
  animateTo: (cam: CameraState, ms: number) => void;
  /** Jump the camera immediately (no animation). */
  snapTo: (cam: CameraState) => void;
  /** Read the live camera on the JS thread (for hit-testing / broadcast). */
  currentCamera: () => CameraState;
  /** Focal-anchored step zoom for a mouse wheel (the react-native-web harness — desktop has no
   *  pinch). A burst of ticks is one motion: it begins on the first tick, disengages follow like
   *  any manual gesture, and settles WHEEL_SETTLE_MS after the last tick. */
  wheelZoom: (focal: { x: number; y: number }, factor: number) => void;
}

export interface UseBoardCameraOpts {
  /** A confirmed tap, with screen point + the camera at tap time (the caller hit-tests). */
  onTap?: ((screen: { x: number; y: number }, cam: CameraState) => void) | undefined;
  /** A manual pan/pinch began (the caller may disengage camera-follow). Programmatic
   *  animateTo never fires this — gestures only. */
  onGesture?: (() => void) | undefined;
}

export function useBoardCamera(
  vp: Viewport,
  view: Bounds,
  home: CameraState,
  opts: UseBoardCameraOpts = {},
): BoardCamera {
  const cx = useSharedValue(home.cx);
  const cy = useSharedValue(home.cy);
  const span = useSharedValue(home.span);
  const pinchStartSpan = useSharedValue(home.span);
  const homeSpan = home.span;

  const seed = useMemo<BoardLod>(() => {
    const s = webScaleEquiv(homeSpan, homeSpan);
    return { bucket: zoomBucket(s), inv: invScale(s), marker: markerScale(s) };
  }, [homeSpan]);
  const [lod, setLod] = useState<BoardLod>(seed);

  const recomputeLod = useCallback(
    (sp: number) => {
      const s = webScaleEquiv(sp, homeSpan);
      const bucket = zoomBucket(s);
      const inv = invScale(s);
      const marker = markerScale(s);
      setLod((prev) =>
        prev.bucket !== bucket || Math.abs(inv - prev.inv) > prev.inv * 0.05
          ? { bucket, inv, marker }
          : prev,
      );
    },
    [homeSpan],
  );

  // ── Motion bookkeeping ────────────────────────────────────────────────────
  // A depth counter spanning every concurrent mover (pan + pinch run simultaneously; follow-mode
  // fires overlapping animateTo glides). While depth > 0 the LOD reaction below is muted, so a
  // whole pinch produces ZERO JS work; the single recompute (→ one re-render → one picture
  // re-record → one snapshot re-raster, all at idle) happens when depth returns to 0.
  const motionDepth = useRef(0);
  const [moving, setMoving] = useState(false);
  const [settled, setSettled] = useState<CameraState>(home);
  const [snapshotCam, setSnapshotCam] = useState<CameraState>(home);
  const movingSV = useSharedValue(false);
  const zoomingSV = useSharedValue(false);
  /** The span the current LOD state was computed for — the mid-gesture throttle reference. */
  const lodSpanSV = useSharedValue(home.span);

  const recomputeSnapshotCam = useCallback((camX: number, camY: number, sp: number) => {
    setSnapshotCam((prev) =>
      prev.cx === camX && prev.cy === camY && prev.span === sp
        ? prev
        : { cx: camX, cy: camY, span: sp },
    );
  }, []);

  const beginMotion = useCallback(() => {
    motionDepth.current += 1;
    if (motionDepth.current === 1) {
      movingSV.value = true;
      setMoving(true);
    }
  }, [movingSV]);
  const endMotion = useCallback(() => {
    motionDepth.current = Math.max(0, motionDepth.current - 1);
    if (motionDepth.current === 0) {
      movingSV.value = false;
      zoomingSV.value = false;
      setMoving(false);
      lodSpanSV.value = span.value;
      recomputeLod(span.value);
      const next = { cx: cx.value, cy: cy.value, span: span.value };
      setSettled((prev) =>
        prev.cx === next.cx && prev.cy === next.cy && prev.span === next.span ? prev : next,
      );
      recomputeSnapshotCam(next.cx, next.cy, next.span);
    }
  }, [movingSV, zoomingSV, lodSpanSV, recomputeLod, recomputeSnapshotCam, cx, cy, span]);

  // Span watcher (UI thread). While a motion is in flight: the first span change flags `zooming`
  // (the web canvas host's mid-pan-repaint exclusion; native's own vector-duck no longer keys off
  // it — see MapSceneSkia's vectorGuard), and the LOD re-quantizes each time the span drifts
  // MID_GESTURE_LOD_RATIO past the last computed value — a few JS recomputes per pinch, so track
  // weight / label tiers follow the zoom without any per-frame JS. The SAME checkpoint also
  // refreshes the raster snapshot's camera (recomputeSnapshotCam), so the cheap texture backing a
  // pinch stays within that ratio of the live span instead of only updating once the gesture ends.
  // At rest the original snapTo re-quantize applies.
  useAnimatedReaction(
    () => span.value,
    (sp, prev) => {
      if (movingSV.value) {
        if (prev !== null && sp !== prev) zoomingSV.value = true;
        const ref = lodSpanSV.value;
        const ratio = sp > ref ? sp / ref : ref / sp;
        if (ratio >= MID_GESTURE_LOD_RATIO) {
          lodSpanSV.value = sp;
          runOnJS(recomputeLod)(sp);
          runOnJS(recomputeSnapshotCam)(cx.value, cy.value, sp);
        }
        return;
      }
      if (prev === null || Math.abs(sp - prev) >= prev * 0.04) {
        lodSpanSV.value = sp;
        runOnJS(recomputeLod)(sp);
      }
    },
    [recomputeLod, recomputeSnapshotCam],
  );

  const notifyGesture = useCallback(() => {
    opts.onGesture?.();
  }, [opts]);
  const notifyTap = useCallback(
    (x: number, y: number) => {
      opts.onTap?.({ x, y }, { cx: cx.value, cy: cy.value, span: span.value });
    },
    [opts, cx, cy, span],
  );
  const snapTo = useCallback(
    (cam: CameraState) => {
      cx.value = cam.cx;
      cy.value = cam.cy;
      span.value = cam.span;
      lodSpanSV.value = cam.span;
      recomputeLod(cam.span);
      setSettled((prev) =>
        prev.cx === cam.cx && prev.cy === cam.cy && prev.span === cam.span ? prev : { ...cam },
      );
      recomputeSnapshotCam(cam.cx, cam.cy, cam.span);
    },
    [cx, cy, span, lodSpanSV, recomputeLod, recomputeSnapshotCam],
  );

  // Every glide pairs one beginMotion with one delayed endMotion; the timers are tracked so an
  // unmount mid-glide never fires a state update afterwards.
  const animTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      for (const id of animTimers.current) clearTimeout(id);
      animTimers.current.clear();
    },
    [],
  );
  const animateTo = useCallback(
    (cam: CameraState, ms: number) => {
      if (ms <= 0) {
        snapTo(cam);
        return;
      }
      const cfg = { duration: ms, easing: Easing.out(Easing.cubic) };
      cx.value = withTiming(cam.cx, cfg);
      cy.value = withTiming(cam.cy, cfg);
      span.value = withTiming(cam.span, cfg);
      beginMotion();
      const id = setTimeout(() => {
        animTimers.current.delete(id);
        endMotion();
      }, ms + ANIMATE_SETTLE_SLACK_MS);
      animTimers.current.add(id);
    },
    [cx, cy, span, snapTo, beginMotion, endMotion],
  );
  // Double-tap zooms in about the tapped point (ports the web's zoom-in double-click intent).
  const zoomAt = useCallback(
    (x: number, y: number) => {
      const cam = { cx: cx.value, cy: cy.value, span: span.value };
      animateTo(pinchTo(cam, { x, y }, 1.6, vp, view), 200);
    },
    [cx, cy, span, vp, view, animateTo],
  );

  const currentCamera = useCallback(
    (): CameraState => ({ cx: cx.value, cy: cy.value, span: span.value }),
    [cx, cy, span],
  );

  // Wheel zoom (web harness). Shared values are writable from the JS thread, so each tick applies
  // the same focal-anchored pinch math directly; the idle timer folds a whole scroll burst into
  // one begin/end motion pair (one follow-disengage, one settle redraw).
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (wheelIdle.current !== null) clearTimeout(wheelIdle.current);
    },
    [],
  );
  const wheelZoom = useCallback(
    (focal: { x: number; y: number }, factor: number) => {
      if (wheelIdle.current === null) {
        beginMotion();
        notifyGesture();
      } else {
        clearTimeout(wheelIdle.current);
      }
      wheelIdle.current = setTimeout(() => {
        wheelIdle.current = null;
        endMotion();
      }, WHEEL_SETTLE_MS);
      const next = pinchTo(
        { cx: cx.value, cy: cy.value, span: span.value },
        focal,
        factor,
        vp,
        view,
      );
      cx.value = next.cx;
      cy.value = next.cy;
      span.value = next.span;
    },
    [beginMotion, endMotion, notifyGesture, cx, cy, span, vp, view],
  );

  const transform = useDerivedValue<Transforms3d>(() => {
    const s = vp.w / span.value;
    return [
      { translateX: vp.w / 2 - cx.value * s },
      { translateY: vp.h / 2 - cy.value * s },
      { scale: s },
    ];
  });

  // Per-gesture "did activate" flags so onFinalize (which fires even for gestures that FAILED
  // without activating, e.g. a tap that never became a pan) only ends motion it actually began.
  const panActive = useSharedValue(false);
  const pinchActive = useSharedValue(false);

  const gesture = useMemo<ComposedGesture>(() => {
    const pan = Gesture.Pan()
      .averageTouches(true)
      .onStart(() => {
        panActive.value = true;
        runOnJS(beginMotion)();
        runOnJS(notifyGesture)();
      })
      .onChange((e) => {
        const s = vp.w / span.value;
        cx.value -= e.changeX / s;
        cy.value -= e.changeY / s;
      })
      .onFinalize(() => {
        if (panActive.value) {
          panActive.value = false;
          runOnJS(endMotion)();
        }
      });
    const pinch = Gesture.Pinch()
      .onStart(() => {
        pinchActive.value = true;
        pinchStartSpan.value = span.value;
        runOnJS(beginMotion)();
        runOnJS(notifyGesture)();
      })
      .onChange((e) => {
        // Focal-anchored zoom: the board point under the focal stays put (camera.pinchTo inlined
        // as a worklet — identical math in shared-value form, as the device-proven spike did).
        const s0 = vp.w / span.value;
        const bx = cx.value + (e.focalX - vp.w / 2) / s0;
        const by = cy.value + (e.focalY - vp.h / 2) / s0;
        const next = clampSpan(pinchStartSpan.value / e.scale, view);
        const s1 = vp.w / next;
        span.value = next;
        cx.value = bx - (e.focalX - vp.w / 2) / s1;
        cy.value = by - (e.focalY - vp.h / 2) / s1;
      })
      .onFinalize(() => {
        if (pinchActive.value) {
          pinchActive.value = false;
          runOnJS(endMotion)();
        }
      });
    const tap = Gesture.Tap()
      .maxDuration(250)
      .onEnd((e, ok) => {
        if (ok) runOnJS(notifyTap)(e.x, e.y);
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((e, ok) => {
        if (ok) runOnJS(zoomAt)(e.x, e.y);
      });
    return Gesture.Race(Gesture.Simultaneous(pan, pinch), Gesture.Exclusive(doubleTap, tap));
  }, [
    vp.w,
    vp.h,
    view,
    cx,
    cy,
    span,
    pinchStartSpan,
    panActive,
    pinchActive,
    beginMotion,
    endMotion,
    notifyGesture,
    notifyTap,
    zoomAt,
  ]);

  return {
    transform,
    gesture,
    lod,
    moving,
    movingSV,
    zoomingSV,
    settled,
    snapshotCam,
    animateTo,
    snapTo,
    currentCamera,
    wheelZoom,
  };
}
