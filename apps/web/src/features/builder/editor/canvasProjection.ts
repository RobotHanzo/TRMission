/** Map a pointer event's client coordinates to the SVG's own user-space (board 0-100 units),
 *  via the element's screen CTM. Returns null when the SVG isn't laid out yet (e.g. jsdom, or a
 *  pre-paint frame) — callers should just ignore the event in that case. */
export function clientToBoardPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (typeof svg.createSVGPoint !== 'function' || typeof svg.getScreenCTM !== 'function')
    return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const inverse = ctm.inverse();
  const transformed = pt.matrixTransform(inverse);
  return { x: transformed.x, y: transformed.y };
}
