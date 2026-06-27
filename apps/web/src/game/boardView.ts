// The "follow the acting player" camera seam: convert between this client's local
// react-zoom-pan-pinch transform (pixel pan + scale) and a SCREEN-INDEPENDENT,
// board-space view descriptor that travels on the wire. Because the descriptor is in
// board units (the 0–100 city space), the same descriptor frames the same region on
// any window — so a viewer on a 4K monitor following a friend on a laptop sees the
// same place, not a pixel-for-pixel copy of a differently-sized viewport.
//
// Geometry mirrors `homeScale`: the board <svg> uses the default `xMidYMid meet`
// preserveAspectRatio, so at rzpp scale 1 one board unit is `k = min(W/BASE_VIEW.w,
// H/BASE_VIEW.h)` content pixels and the board is letter-boxed (centred) inside W×H.
import { BASE_VIEW, MIN_SCALE, MAX_SCALE } from './geography';

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

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Board-units → content-pixels factor at scale 1, plus the letter-box offsets. */
function metrics(wrapperW: number, wrapperH: number) {
  const k = Math.min(wrapperW / BASE_VIEW.w, wrapperH / BASE_VIEW.h) || 1;
  const offX = (wrapperW - BASE_VIEW.w * k) / 2;
  const offY = (wrapperH - BASE_VIEW.h * k) / 2;
  return { k, offX, offY };
}

/** This client's current transform → the board-space descriptor to broadcast. */
export function transformToView(
  t: BoardTransform,
  wrapperW: number,
  wrapperH: number,
): ViewDescriptor {
  const { k, offX, offY } = metrics(wrapperW, wrapperH);
  const s = t.scale || 1;
  // Invert screen = position + content*scale to recover the content-pixel under the
  // viewport centre, then map that back into board units.
  const contentXc = (wrapperW / 2 - t.positionX) / s;
  const contentYc = (wrapperH / 2 - t.positionY) / s;
  return {
    cx: BASE_VIEW.x + (contentXc - offX) / k,
    cy: BASE_VIEW.y + (contentYc - offY) / k,
    span: wrapperW / (k * s),
  };
}

/** A received descriptor → the transform THIS viewer must apply to match the framing. */
export function viewToTransform(
  view: ViewDescriptor,
  wrapperW: number,
  wrapperH: number,
): BoardTransform {
  const { k, offX, offY } = metrics(wrapperW, wrapperH);
  // span = W/(k*s) ⇒ s = W/(span*k); clamp to the board's pan/zoom bounds.
  const span = view.span > 0 ? view.span : BASE_VIEW.w;
  const scale = clamp(wrapperW / (span * k), MIN_SCALE, MAX_SCALE);
  const contentXc = offX + (view.cx - BASE_VIEW.x) * k;
  const contentYc = offY + (view.cy - BASE_VIEW.y) * k;
  return {
    positionX: wrapperW / 2 - contentXc * scale,
    positionY: wrapperH / 2 - contentYc * scale,
    scale,
  };
}
