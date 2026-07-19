// The board's canvas host — WEB (react-native-web harness) implementation. There is no UI thread
// in a browser: every gesture frame runs on the main JS thread, and a Reanimated-driven Skia
// <Group> transform forces a full CanvasKit-wasm canvas redraw per frame — the exact recipe for
// the janky pan/zoom this file replaces. Instead the canvas is drawn ONCE per camera settle (at
// the settled camera, with an overdraw margin around the viewport) and gestures move it with a
// composited CSS transform on a wrapper — zero canvas redraws mid-gesture, the same
// texture-compositing trick the web client gets from react-zoom-pan-pinch around its SVG.
// Desktop input parity: a wheel listener feeds cam.wheelZoom (focal-anchored, like the web
// client's wheel zoom); RNGH already maps mouse drag → pan and double-click → zoom.
import { useEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Canvas, Group } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import type { CameraState } from './camera';
import type { BoardCanvasProps } from './BoardCanvas';

/** Extra viewport fraction drawn beyond each edge, so a pan has real pixels to reveal before the
 *  next settle recenters the canvas. */
const COVER = 0.35;
/** Re-render the canvas when a settle leaves less than this fraction of viewport as margin. */
const ADOPT_SLACK = 0.12;
/** Browser texture ceiling — the canvas backing store (CSS px × devicePixelRatio) stays under
 *  common WebGL MAX_TEXTURE_SIZE limits. */
const MAX_CANVAS_PX = 8192;
/** Wheel step → zoom factor, matching the web client's react-zoom-pan-pinch wheel feel. */
const WHEEL_STEP = 0.0022;

/** How much sea margin the canvas draws past each viewport edge (capped by the GPU texture
 *  ceiling on high-DPR displays). */
const marginFor = (dim: number, dpr: number): number =>
  Math.max(0, Math.min(COVER * dim, (MAX_CANVAS_PX / dpr - dim) / 2));

export function BoardCanvas({ cam, vp, children }: BoardCanvasProps): React.JSX.Element {
  // The camera the canvas is currently DRAWN for. A pan-only settle inside the overdraw budget
  // keeps the existing pixels (the CSS transform is pixel-perfect under pure translation and the
  // scale is unchanged) — no redraw, no swap artifact; a zoom settle or an edge-approaching pan
  // adopts the new settled camera and repaints crisp.
  const [canvasCam, setCanvasCam] = useState<CameraState>(cam.settled);
  const dpr = PixelRatio.get() || 1;
  const mx = marginFor(vp.w, dpr);
  const my = marginFor(vp.h, dpr);
  useEffect(() => {
    const s = cam.settled;
    if (s === canvasCam) return;
    const sc = vp.w / canvasCam.span;
    const zoomed = s.span !== canvasCam.span;
    const dx = Math.abs(s.cx - canvasCam.cx) * sc;
    const dy = Math.abs(s.cy - canvasCam.cy) * sc;
    if (zoomed || dx > mx - ADOPT_SLACK * vp.w || dy > my - ADOPT_SLACK * vp.h) setCanvasCam(s);
  }, [cam.settled, canvasCam, vp, mx, my]);

  // The settled screen transform (board units → viewport px) the canvas is painted with.
  const s = vp.w / canvasCam.span;
  const tx = vp.w / 2 - canvasCam.cx * s;
  const ty = vp.h / 2 - canvasCam.cy * s;

  // Live-vs-painted delta, applied as a CSS transform about the viewport origin: with the live
  // screen transform q = p·sL + tL and the canvas painted at q' = p·s + t, the wrapper needs
  // T(q') = k·q' + (tL − k·t), k = sL/s — identity whenever live == painted.
  const deltaStyle = useAnimatedStyle(() => {
    const live = cam.transform.value as unknown as readonly [
      { translateX: number },
      { translateY: number },
      { scale: number },
    ];
    const k = live[2].scale / s;
    return {
      transform: [
        { translateX: live[0].translateX - k * tx },
        { translateY: live[1].translateY - k * ty },
        { scale: k },
      ],
    };
  }, [s, tx, ty, cam.transform]);

  // Mouse-wheel zoom about the cursor (native wheel event — RNGH has no wheel gesture).
  const wheelHostRef = useRef<View>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  useEffect(() => {
    const node = wheelHostRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      camRef.current.wheelZoom(
        { x: e.clientX - r.left, y: e.clientY - r.top },
        Math.exp(-e.deltaY * WHEEL_STEP),
      );
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <GestureDetector gesture={cam.gesture}>
      <View style={styles.host}>
        <View ref={wheelHostRef} style={styles.clip}>
          <Animated.View style={[styles.origin, deltaStyle]}>
            <Canvas
              style={{
                position: 'absolute',
                left: -mx,
                top: -my,
                width: vp.w + 2 * mx,
                height: vp.h + 2 * my,
              }}
            >
              <Group transform={[{ translateX: tx + mx }, { translateY: ty + my }, { scale: s }]}>
                {children}
              </Group>
            </Canvas>
          </Animated.View>
        </View>
      </View>
    </GestureDetector>
  );
}

const fill = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const;
const styles = StyleSheet.create({
  host: { flex: 1 },
  clip: { ...fill, overflow: 'hidden' },
  origin: { ...fill, transformOrigin: 'top left' },
});
