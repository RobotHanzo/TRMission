// The "follow the acting player" camera seam: convert between this client's local
// react-zoom-pan-pinch transform (pixel pan + scale) and a SCREEN-INDEPENDENT,
// board-space view descriptor that travels on the wire. Because the descriptor is in
// board units (the 0–100 city space), the same descriptor frames the same region on
// any window — so a viewer on a 4K monitor following a friend on a laptop sees the
// same place, not a pixel-for-pixel copy of a differently-sized viewport.
//
// The board↔pixel mapping is NOT modelled from the viewport. react-zoom-pan-pinch sizes
// its content box to `fit-content` (the board <svg>'s own intrinsic box, not the W×H
// viewport), so a letterbox computed from the viewport is wrong — it round-trips with
// itself but maps a TRUE board coordinate (e.g. a bot's action POI) to the wrong place,
// off the map. Instead we read the live board <svg> `getCTM()` — the viewBox→content-pixel
// affine, which excludes the rzpp CSS transform and so is invariant to zoom/pan — and
// project through that. Same "measure the real geometry" tack `frameHome` takes.
import { MIN_SCALE, MAX_SCALE } from './geography';

/** A board auto-pan target: a set of route ids or city ids to frame. */
export interface BoardFrameTarget {
  kind: 'route' | 'cities';
  ids: string[];
}

/** react-zoom-pan-pinch transform state (a subset of its `ReactZoomPanPinchState`). */
export interface BoardTransform {
  /** Horizontal pan in screen pixels (rzpp `positionX`). */
  positionX: number;
  /** Vertical pan in screen pixels (rzpp `positionY`). */
  positionY: number;
  /** Zoom multiplier (rzpp `scale`). */
  scale: number;
}

/** A viewport framing in board units — what we put on the wire (`CameraView`). */
export interface ViewDescriptor {
  /** Board x (0–100 space) under the viewport centre. */
  cx: number;
  /** Board y (0–100 space) under the viewport centre. */
  cy: number;
  /** How many board units span the viewport WIDTH (the zoom metric). */
  span: number;
}

/**
 * The board→content-pixel affine, read from the board <svg>'s `getCTM()`. Uniform scale,
 * no rotation, so a content pixel is `k·board + (e,f)`. `k` is content-pixels per board
 * unit at rzpp scale 1 (constant — `getCTM` ignores the CSS zoom on the content div).
 */
export interface BoardProjection {
  k: number;
  e: number;
  f: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Build the projection from the live board <svg> (its `getCTM`), or null when the element
 * isn't laid out yet / `getCTM` is unavailable (e.g. jsdom). Callers skip the camera move
 * on null rather than projecting through a bogus identity.
 */
export function boardProjection(svg: SVGSVGElement | null | undefined): BoardProjection | null {
  if (!svg || typeof svg.getCTM !== 'function') return null;
  const m = svg.getCTM();
  if (!m || !m.a) return null;
  return { k: m.a, e: m.e, f: m.f };
}

/** This client's current transform → the board-space descriptor to broadcast. */
export function transformToView(
  t: BoardTransform,
  proj: BoardProjection,
  wrapperW: number,
  wrapperH: number,
): ViewDescriptor {
  const s = t.scale || 1;
  const k = proj.k || 1;
  // Invert screen = position + content*scale to recover the content-pixel under the
  // viewport centre, then map that back into board units through the inverse CTM.
  const contentXc = (wrapperW / 2 - t.positionX) / s;
  const contentYc = (wrapperH / 2 - t.positionY) / s;
  return {
    cx: (contentXc - proj.e) / k,
    cy: (contentYc - proj.f) / k,
    span: wrapperW / (k * s),
  };
}

/**
 * Fraction (0–1) of the given board-space points that currently fall within the W×H viewport,
 * under the live transform `t` and projection `proj`. Used to gate the route-claim glow: feeding
 * the route's car centres tells us how much of the railway is on screen, so the highlight can wait
 * until it's at least half in view instead of flashing while the follow-camera is still panning.
 */
export function visibleFraction(
  points: readonly { x: number; y: number }[],
  t: BoardTransform,
  proj: BoardProjection,
  wrapperW: number,
  wrapperH: number,
): number {
  if (points.length === 0) return 0;
  const s = t.scale || 1;
  let inside = 0;
  for (const p of points) {
    // board → content-pixel (k·board + offset) → screen (position + content·scale).
    const sx = t.positionX + (proj.k * p.x + proj.e) * s;
    const sy = t.positionY + (proj.k * p.y + proj.f) * s;
    if (sx >= 0 && sx <= wrapperW && sy >= 0 && sy <= wrapperH) inside++;
  }
  return inside / points.length;
}

/** A received descriptor → the transform THIS viewer must apply to match the framing. */
export function viewToTransform(
  view: ViewDescriptor,
  proj: BoardProjection,
  wrapperW: number,
  wrapperH: number,
): BoardTransform {
  const k = proj.k || 1;
  // span = W/(k*s) ⇒ s = W/(span*k); clamp to the board's pan/zoom bounds.
  const span = view.span > 0 ? view.span : wrapperW / k;
  const scale = clamp(wrapperW / (span * k), MIN_SCALE, MAX_SCALE);
  const contentXc = proj.e + view.cx * k;
  const contentYc = proj.f + view.cy * k;
  return {
    positionX: wrapperW / 2 - contentXc * scale,
    positionY: wrapperH / 2 - contentYc * scale,
    scale,
  };
}
