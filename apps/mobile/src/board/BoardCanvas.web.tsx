// The board's canvas host — WEB (react-native-web harness) implementation. There is no UI thread
// in a browser: every gesture frame runs on the main JS thread, and a Reanimated-driven Skia
// <Group> transform forces a full CanvasKit-wasm canvas redraw per frame — the exact recipe for
// the janky pan/zoom this file replaces. Instead the canvas is painted at a settled camera and
// gestures move it with a composited CSS transform on a wrapper — zero canvas redraws
// mid-gesture, the same texture-compositing trick the web client gets from react-zoom-pan-pinch
// around its SVG.
//
// Three hard-won invariants (each covers a reported artifact — keep them):
// - COVERAGE: the canvas covers the WHOLE scene at the painted scale whenever the GPU budget
//   allows (it always does near home zoom), so ordinary panning never exposes unpainted void the
//   way a viewport-margin snapshot would; only deep zoom falls back to a budgeted window around
//   the viewport, and a mid-pan watcher repaints BEFORE the edge scrolls into view.
// - ATOMIC SWAP: a repaint changes the canvas bitmap (drawn on RNSkia-web's persistent rAF tick)
//   and the wrapper's CSS baseline. Swapping the baseline in React state with the paint pending
//   shows the OLD bitmap at the NEW baseline for a frame — the "wrong zoom flashes" flicker. The
//   baseline therefore lives in a shared value updated in a requestAnimationFrame scheduled from
//   the commit effect: RNSkia's tick (registered a frame earlier) runs first, so bitmap and
//   baseline land in the SAME browser composite.
// - PIXEL GRID: at rest after a pan the wrapper carries a fractional translate; compositing a
//   raster off the device-pixel grid resamples it (the "routes look blurry" report — SVG on the
//   web client re-rasterizes under transform, a canvas cannot). Pure translations are therefore
//   snapped to device pixels in the animated style.
//
// Desktop input parity: a wheel listener feeds cam.wheelZoom (focal-anchored, like the web
// client's wheel zoom); RNGH already maps mouse drag → pan and double-click → zoom.
import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { Canvas, Group } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import type { CameraState } from './camera';
import type { BoardCanvasProps } from './BoardCanvas';

/** Per-side texture ceiling in DEVICE px (common WebGL MAX_TEXTURE_SIZE floor). */
const MAX_TEXTURE_PX = 8192;
/** Total canvas budget in DEVICE px² (~72MB RGBA) — the whole scene fits under it except at
 *  deep zoom, where the budgeted window + the mid-pan watcher take over. */
const MAX_AREA_PX = 18_000_000;
/** Painted margin (px) the viewport may approach before a repaint re-centres the window. */
const EDGE_SLACK = 64;
/** Wheel step → zoom factor, matching the web client's react-zoom-pan-pinch wheel feel. */
const WHEEL_STEP = 0.0022;

interface ScreenTransform {
  s: number;
  tx: number;
  ty: number;
}

const screenTransform = (cam: CameraState, vpW: number, vpH: number): ScreenTransform => {
  const s = vpW / cam.span;
  return { s, tx: vpW / 2 - cam.cx * s, ty: vpH / 2 - cam.cy * s };
};

export function BoardCanvas({
  cam,
  vp,
  sceneBounds,
  children,
}: BoardCanvasProps): React.JSX.Element {
  const dpr = PixelRatio.get() || 1;

  // The camera the canvas is currently PAINTED for. A pan-only settle inside the painted region
  // keeps the existing pixels (pure translation is pixel-perfect after grid-snapping) — no
  // repaint, no swap; a zoom settle or an edge-approaching pan adopts and repaints.
  const [canvasCam, setCanvasCam] = useState<CameraState>(cam.settled);

  // ── Painted geometry (viewport coords, integer CSS px) ────────────────────
  const painted = screenTransform(canvasCam, vp.w, vp.h);
  // World rect of the whole scene at the painted transform.
  const worldX = sceneBounds.x * painted.s + painted.tx;
  const worldY = sceneBounds.y * painted.s + painted.ty;
  const worldW = sceneBounds.w * painted.s;
  const worldH = sceneBounds.h * painted.s;
  // Budgeted cover size: the whole scene when it fits, else a window around the viewport.
  let coverW = Math.min(worldW, MAX_TEXTURE_PX / dpr);
  let coverH = Math.min(worldH, MAX_TEXTURE_PX / dpr);
  const areaMax = MAX_AREA_PX / (dpr * dpr);
  if (coverW * coverH > areaMax) {
    const f = Math.sqrt(areaMax / (coverW * coverH));
    coverW = Math.max(Math.min(vp.w * 1.6, worldW), coverW * f);
    coverH = Math.max(Math.min(vp.h * 1.6, worldH), coverH * f);
  }
  // Quantize the size to coarse steps: a CSS resize can never be frame-atomic (the browser
  // stretches the old bitmap before any redraw), so keep resizes to rare zoom jumps — ordinary
  // adoptions then only MOVE the element, which the atomic baseline swap fully covers.
  const SIZE_STEP = 512;
  const sideCap = MAX_TEXTURE_PX / dpr;
  coverW = Math.min(Math.ceil(coverW / SIZE_STEP) * SIZE_STEP, Math.floor(sideCap));
  coverH = Math.min(Math.ceil(coverH / SIZE_STEP) * SIZE_STEP, Math.floor(sideCap));
  // Position: contain the viewport (centred when possible), clamped inside the world; integer
  // CSS px so the canvas element sits on the pixel grid (fractional positions resample). A
  // quantized size may exceed the world — the clamp then pins to the world origin and the
  // excess just draws empty sea.
  const clampPos = (want: number, lo: number, hi: number): number =>
    Math.round(Math.max(lo, Math.min(want, hi)));
  const coverX = clampPos((vp.w - coverW) / 2, worldX, worldX + worldW - coverW);
  const coverY = clampPos((vp.h - coverH) / 2, worldY, worldY + worldH - coverH);

  // Latest geometry in refs for the JS-side coverage test (identity-stable callbacks).
  const geom = useRef({ painted, coverX, coverY, coverW, coverH, worldX, worldY, worldW, worldH });
  geom.current = { painted, coverX, coverY, coverW, coverH, worldX, worldY, worldW, worldH };
  const canvasCamRef = useRef(canvasCam);
  canvasCamRef.current = canvasCam;
  const camRef = useRef(cam);
  camRef.current = cam;
  const vpRef = useRef(vp);
  vpRef.current = vp;

  /** Would the viewport under `at` stray past the painted region (ignoring sides where the
   *  painting already reaches the scene edge — there is nothing more to draw out there)? */
  const uncovered = useCallback((at: CameraState): boolean => {
    const g = geom.current;
    const v = vpRef.current;
    const { s, tx, ty } = g.painted;
    // Viewport rect under `at`, projected into the painted screen space.
    const spanY = (at.span * v.h) / v.w;
    const left = (at.cx - at.span / 2) * s + tx;
    const top = (at.cy - spanY / 2) * s + ty;
    const right = left + (at.span / canvasCamRef.current.span) * v.w;
    const bottom = top + (at.span / canvasCamRef.current.span) * v.h;
    const needL = left < g.coverX + EDGE_SLACK && g.coverX > g.worldX + 1;
    const needR =
      right > g.coverX + g.coverW - EDGE_SLACK && g.coverX + g.coverW < g.worldX + g.worldW - 1;
    const needT = top < g.coverY + EDGE_SLACK && g.coverY > g.worldY + 1;
    const needB =
      bottom > g.coverY + g.coverH - EDGE_SLACK && g.coverY + g.coverH < g.worldY + g.worldH - 1;
    return needL || needR || needT || needB;
  }, []);

  // Settle adoption: repaint on any zoom change (crispness) or an uncovered pan.
  useEffect(() => {
    const st = cam.settled;
    const cur = canvasCamRef.current;
    if (st.cx === cur.cx && st.cy === cur.cy && st.span === cur.span) return;
    if (st.span !== cur.span || uncovered(st)) setCanvasCam({ ...st });
  }, [cam.settled, uncovered]);

  // Mid-PAN adoption: while a pure pan is in flight, a ~6Hz check repaints before the painted
  // edge scrolls into view (the settle-only version required "staying static" to fill the void).
  // Zooming is excluded — span changes repaint at settle, and mid-zoom k≠1 makes snapping moot.
  const checkMidPan = useCallback(() => {
    const live = camRef.current.currentCamera();
    if (live.span === canvasCamRef.current.span && uncovered(live)) setCanvasCam({ ...live });
  }, [uncovered]);
  const panFrame = useSharedValue(0);
  useAnimatedReaction(
    () => (cam.movingSV.value && !cam.zoomingSV.value ? cam.transform.value : null),
    (v) => {
      if (v === null) return;
      panFrame.value = (panFrame.value + 1) % 10;
      if (panFrame.value === 0) runOnJS(checkMidPan)();
    },
    [cam.movingSV, cam.zoomingSV, cam.transform, checkMidPan],
  );

  // ── The frame-atomic CSS baseline (see the ATOMIC SWAP invariant above) ───
  const baseSV = useSharedValue<ScreenTransform>(painted);
  useEffect(() => {
    const next = { s: painted.s, tx: painted.tx, ty: painted.ty };
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 16) as unknown as number;
    const id = raf(() => {
      baseSV.value = next;
    });
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    };
  }, [painted.s, painted.tx, painted.ty, baseSV]);

  // Live-vs-painted delta about the viewport origin: with the live screen transform
  // q = p·sL + tL and the canvas painted at q' = p·s + t, the wrapper needs
  // T(q') = k·q' + (tL − k·t), k = sL/s — identity whenever live == painted.
  const deltaStyle = useAnimatedStyle(() => {
    const live = cam.transform.value as unknown as readonly [
      { translateX: number },
      { translateY: number },
      { scale: number },
    ];
    const base = baseSV.value;
    const k = live[2].scale / base.s;
    let dx = live[0].translateX - k * base.tx;
    let dy = live[1].translateY - k * base.ty;
    if (Math.abs(k - 1) < 1e-4) {
      // Pure translation of a raster: snap to the DEVICE pixel grid (see PIXEL GRID above).
      dx = Math.round(dx * dpr) / dpr;
      dy = Math.round(dy * dpr) / dpr;
      return { transform: [{ translateX: dx }, { translateY: dy }, { scale: 1 }] };
    }
    return { transform: [{ translateX: dx }, { translateY: dy }, { scale: k }] };
  }, [cam.transform, baseSV, dpr]);

  // Mouse-wheel zoom about the cursor (native wheel event — RNGH has no wheel gesture).
  const wheelHostRef = useRef<View>(null);
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
                left: coverX,
                top: coverY,
                width: coverW,
                height: coverH,
              }}
            >
              <Group
                transform={[
                  { translateX: painted.tx - coverX },
                  { translateY: painted.ty - coverY },
                  { scale: painted.s },
                ]}
              >
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
