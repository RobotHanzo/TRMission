// The mobile board camera, modelled NATIVELY in board units as {cx, cy, span} — the exact
// shape the wire's CameraView / the web's ViewDescriptor carries (see apps/web/src/game/
// boardView.ts). The web needed transformToView/viewToTransform to bridge react-zoom-pan-
// pinch's pixel transform to that descriptor; here the descriptor IS the camera state, so
// follow-the-actor consumes and broadcasts it with no conversion. Pure — no RN imports —
// so every function unit-tests without a device.

export interface Viewport {
  w: number;
  h: number;
}
export interface CameraState {
  /** Board x/y (0–100 content space) under the viewport centre. */
  cx: number;
  cy: number;
  /** Board units spanned by the viewport WIDTH (the zoom metric; smaller = closer). */
  span: number;
}
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Closest-up zoom: ~3–4 stations across a phone. Mirrors the web's MAX_SCALE=8 head-room. */
export const SPAN_MIN = 8;
/** Widest zoom: a little beyond the full base view (web MIN_SCALE=0.8 ⇒ content at 125%).
 *  Worklet: called synchronously from the pinch gesture's UI-thread `onChange` via clampSpan. */
export const spanMax = (view: Bounds): number => {
  'worklet';
  return 1.25 * view.w;
};

/** Board units spanned when auto-framing a bot's action POI (ports verbatim from Board.tsx —
 *  it was already screen-independent board units on the web). */
export const BOT_FOLLOW_SPAN = 34;

export const pxPerUnit = (cam: CameraState, vp: Viewport): number => vp.w / cam.span;

/** Worklet: called synchronously from the pinch gesture's UI-thread `onChange` (useBoardCamera). */
export const clampSpan = (span: number, view: Bounds): number => {
  'worklet';
  return Math.min(spanMax(view), Math.max(SPAN_MIN, span));
};

export function boardToScreen(
  p: { x: number; y: number },
  cam: CameraState,
  vp: Viewport,
): { x: number; y: number } {
  const s = pxPerUnit(cam, vp);
  return { x: (p.x - cam.cx) * s + vp.w / 2, y: (p.y - cam.cy) * s + vp.h / 2 };
}

export function screenToBoard(
  p: { x: number; y: number },
  cam: CameraState,
  vp: Viewport,
): { x: number; y: number } {
  const s = pxPerUnit(cam, vp);
  return { x: cam.cx + (p.x - vp.w / 2) / s, y: cam.cy + (p.y - vp.h / 2) / s };
}

/** One-finger pan: the content follows the finger, so the centre moves the other way. */
export function panBy(cam: CameraState, dxPx: number, dyPx: number, vp: Viewport): CameraState {
  const s = pxPerUnit(cam, vp);
  return { cx: cam.cx - dxPx / s, cy: cam.cy - dyPx / s, span: cam.span };
}

/** Pinch about a focal point: zoom by `factor`, keeping the board point under the focal
 *  screen point stationary (the standard focal-pinch invariant). */
export function pinchTo(
  cam: CameraState,
  focalPx: { x: number; y: number },
  factor: number,
  vp: Viewport,
  view: Bounds,
): CameraState {
  const anchor = screenToBoard(focalPx, cam, vp);
  const span = clampSpan(cam.span / factor, view);
  const s = vp.w / span;
  return {
    cx: anchor.x - (focalPx.x - vp.w / 2) / s,
    cy: anchor.y - (focalPx.y - vp.h / 2) / s,
    span,
  };
}

/**
 * Home/reset framing: the smallest span that CONTAINS `bounds` with a padding margin —
 * the same contain-and-centre semantics as the web's fitTransform (game/geography.ts),
 * re-expressed in span space. Width constrains directly; height constrains via the
 * viewport aspect (visible board height = span · vp.h / vp.w).
 */
export function homeCamera(bounds: Bounds, vp: Viewport, padding = 0.9): CameraState {
  const span = Math.max(bounds.w / padding, (bounds.h * (vp.w / vp.h)) / padding);
  return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, span };
}

/**
 * What to frame at home: a custom map's land-ring bbox, else the non-island city bbox
 * padded — the pure stand-in for the web's DOM-measured `path.land` rect (frameHome).
 */
export function boundsOfContent(content: {
  cities: readonly { x: number; y: number; isIsland?: boolean | undefined }[];
  geography?: { land: readonly (readonly (readonly [number, number])[])[] } | null | undefined;
}): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  if (content.geography && content.geography.land.length > 0) {
    for (const ring of content.geography.land)
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  const pad = 4;
  for (const c of content.cities) {
    if (c.isIsland) continue;
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

// ── LOD port ─────────────────────────────────────────────────────────────────
// The web's zoomBucket/inv-scale/marker-scale (game/lod.ts + Board.tsx ZoomTracker) are
// functions of the rzpp scale. Mobile has no rzpp scale, so we anchor: the HOME framing
// is defined to sit at web-scale 2.4 — the 'local' tier the Board seeds data-zoom with —
// and every other span maps proportionally. One calibration constant, unit-tested.
export const HOME_SCALE_EQUIV = 2.4;

export const webScaleEquiv = (span: number, homeSpan: number): number =>
  HOME_SCALE_EQUIV * (homeSpan / span);

export type ZoomBucket = 'far' | 'regional' | 'district' | 'local';
/** Ports game/lod.ts zoomBucket verbatim (same thresholds on the equivalent scale). */
export const zoomBucket = (scale: number): ZoomBucket =>
  scale < 1.25 ? 'far' : scale < 1.7 ? 'regional' : scale < 2.4 ? 'district' : 'local';

/** Ports Board.tsx ZoomTracker's --inv-scale: labels/track weight counter-scale. */
export const invScale = (scale: number): number => Math.max(0.12, Math.min(1.5, 1 / scale));
/** Ports --marker-scale: station markers grow ≈√zoom, clamped. */
export const markerScale = (scale: number): number =>
  Math.max(0.34, Math.min(0.82, 1 / Math.sqrt(scale)));

// ── Gesture-time raster cache ────────────────────────────────────────────────
// While the camera moves, the board draws a pre-rasterized snapshot of the static scene (one
// textured quad per frame) instead of replaying the full vector picture — the native analogue of
// the browser compositing the web board's SVG layer, which is why the web build pans at full FPS
// on the same hardware. The snapshot is re-rendered at every camera settle, so at rest the crisp
// vector picture is always what's on screen and the texture only ever shows mid-motion.

/** Cover this many viewports (per axis, centred on the settle camera) so a whole gesture — a
 *  full-screen drag or a 3× pinch-out — stays inside the snapshot before the next settle. */
const RASTER_PAD = 3;
/** Texture dimension cap (device px): keeps the worst-case snapshot ≤ a few dozen MB and inside
 *  every GPU's max-texture-size. Past the cap the snapshot just gets softer mid-gesture. */
export const RASTER_MAX_DIM = 4096;

export interface RasterSpec {
  /** Board-space region the snapshot covers. */
  rect: Bounds;
  /** Device pixels per board unit the snapshot is rendered at. */
  pxPerUnit: number;
}

/** The snapshot region + resolution for a settled camera: the visible box padded to RASTER_PAD
 *  viewports per axis, clamped to the scene, rendered 1:1 with device pixels up to the cap. */
export function rasterSpec(
  cam: CameraState,
  vp: Viewport,
  scene: Bounds,
  pixelRatio: number,
  maxDim = RASTER_MAX_DIM,
): RasterSpec | null {
  if (vp.w <= 0 || vp.h <= 0 || cam.span <= 0) return null;
  const visW = cam.span;
  const visH = cam.span * (vp.h / vp.w);
  const x = Math.max(scene.x, cam.cx - (visW * RASTER_PAD) / 2);
  const y = Math.max(scene.y, cam.cy - (visH * RASTER_PAD) / 2);
  const w = Math.min(scene.x + scene.w, cam.cx + (visW * RASTER_PAD) / 2) - x;
  const h = Math.min(scene.y + scene.h, cam.cy + (visH * RASTER_PAD) / 2) - y;
  if (w <= 0 || h <= 0) return null;
  const pxPerUnit = Math.min((pixelRatio * vp.w) / cam.span, maxDim / w, maxDim / h);
  if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) return null;
  return { rect: { x, y, w, h }, pxPerUnit };
}

/** Fraction of board-space points inside the viewport (ports boardView.ts visibleFraction
 *  through the analytic projection — gates the claim glow, Task 5). */
export function visibleFraction(
  points: readonly { x: number; y: number }[],
  cam: CameraState,
  vp: Viewport,
): number {
  if (points.length === 0) return 0;
  let inside = 0;
  for (const p of points) {
    const q = boardToScreen(p, cam, vp);
    if (q.x >= 0 && q.x <= vp.w && q.y >= 0 && q.y <= vp.h) inside++;
  }
  return inside / points.length;
}
