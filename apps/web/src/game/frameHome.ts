import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import type { BoardBounds } from '@trm/client-core/game/boardModel';
import { fitTransform } from './geography';
import { boardProjection } from './boardView';

/**
 * The home/reset view: frame `bounds` (board units — the network box from `homeBounds`) to the
 * live viewport and centre it. The pan/zoom content sizes to the SVG's intrinsic box, not the
 * viewport, so the board's on-screen size can't be modelled from the viewport alone — we read the
 * board↔content-pixel affine off the live `<svg class="board">` (`getCTM`, which excludes the rzpp
 * CSS transform, so it's the same at any zoom), project the box through it, and fit that.
 * This holds at any window shape/geography, so every `MapScene` surface (the live board, the
 * builder canvas) that calls this on init settles at the same effective zoom — which keeps
 * `--inv-scale`, and so city-label size, in parity across surfaces.
 */
export function frameHome(
  ref: ReactZoomPanPinchContentRef,
  animationTime: number,
  bounds: BoardBounds,
): void {
  const { instance, setTransform } = ref;
  const wrap = instance.wrapperComponent;
  const content = instance.contentComponent;
  if (!wrap || !content || !(bounds.w > 0) || !(bounds.h > 0)) return;
  const proj = boardProjection(content.querySelector<SVGSVGElement>('svg.board'));
  const wr = wrap.getBoundingClientRect();
  if (!proj || !wr.width || !wr.height) return; // not laid out (e.g. jsdom)
  // Board units → the content's own pixel space (`k·board + (e,f)`), which is where a rzpp
  // transform lives.
  const target = {
    cx: proj.k * (bounds.x + bounds.w / 2) + proj.e,
    cy: proj.k * (bounds.y + bounds.h / 2) + proj.f,
    w: proj.k * bounds.w,
    h: proj.k * bounds.h,
  };
  const t = fitTransform(target, { w: wr.width, h: wr.height });
  setTransform(t.x, t.y, t.scale, animationTime, 'easeOut');
}
