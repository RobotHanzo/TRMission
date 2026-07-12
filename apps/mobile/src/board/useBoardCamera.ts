// The board camera as a reusable hook: the spike's device-proven pan/pinch/tap gestures promoted
// to a Reanimated shared-value camera ({cx, cy, span}), plus the quantized LOD state (bucket / inv /
// marker) MapSceneSkia needs to counter-scale track weight, labels, and markers. The Skia Group
// transform is a derived value (UI thread); LOD is discrete React state recomputed on the JS thread
// only when the zoom moves enough to matter — the native equivalent of the web's per-frame CSS-var
// writes, minus that jank. Used by the dev board screen now and the online/offline BoardView next.
import { useCallback, useMemo, useState } from 'react';
import { Gesture, type ComposedGesture } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type DerivedValue,
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
  /** Ease the camera to a target over `ms` (programmatic — never disengages follow). */
  animateTo: (cam: CameraState, ms: number) => void;
  /** Jump the camera immediately (no animation). */
  snapTo: (cam: CameraState) => void;
  /** Read the live camera on the JS thread (for hit-testing / broadcast). */
  currentCamera: () => CameraState;
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

  // Wake the JS thread to re-quantize LOD only when the span moves enough to possibly cross a
  // threshold — a cheap arithmetic-only worklet, no cross-module calls on the UI thread.
  useAnimatedReaction(
    () => span.value,
    (sp, prev) => {
      if (prev === null || Math.abs(sp - prev) >= prev * 0.04) runOnJS(recomputeLod)(sp);
    },
    [recomputeLod],
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
    },
    [cx, cy, span],
  );
  const animateTo = useCallback(
    (cam: CameraState, ms: number) => {
      const cfg = { duration: ms, easing: Easing.out(Easing.cubic) };
      cx.value = withTiming(cam.cx, cfg);
      cy.value = withTiming(cam.cy, cfg);
      span.value = withTiming(cam.span, cfg);
    },
    [cx, cy, span],
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

  const transform = useDerivedValue<Transforms3d>(() => {
    const s = vp.w / span.value;
    return [
      { translateX: vp.w / 2 - cx.value * s },
      { translateY: vp.h / 2 - cy.value * s },
      { scale: s },
    ];
  });

  const gesture = useMemo<ComposedGesture>(() => {
    const pan = Gesture.Pan()
      .averageTouches(true)
      .onStart(() => {
        runOnJS(notifyGesture)();
      })
      .onChange((e) => {
        const s = vp.w / span.value;
        cx.value -= e.changeX / s;
        cy.value -= e.changeY / s;
      });
    const pinch = Gesture.Pinch()
      .onStart(() => {
        pinchStartSpan.value = span.value;
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
  }, [vp.w, vp.h, view, cx, cy, span, pinchStartSpan, notifyGesture, notifyTap, zoomAt]);

  return { transform, gesture, lod, animateTo, snapTo, currentCamera };
}
