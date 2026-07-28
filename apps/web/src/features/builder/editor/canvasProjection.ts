/**
 * Map a pointer event's client coordinates to the SVG's own user space — board 0-100 units on the
 * editor canvas, lon/lat on the world canvas.
 *
 * Deliberately NOT `getScreenCTM()`, the obvious way to do this: both editor canvases live inside
 * react-zoom-pan-pinch, which pans and zooms them with a CSS transform on an ancestor div, and
 * WebKit leaves an ancestor's CSS scale out of the matrix `getScreenCTM()` returns
 * (webkit.org/b/209220). Desktop Chrome and Firefox include it, so the bug is invisible there and
 * total in a WKWebView — which is exactly where the mobile builder runs, and why a tap placed a
 * station nowhere near the finger (#72). `getBoundingClientRect()` carries ancestor transforms in
 * every engine, and the pan/zoom transform is translate+scale only (no rotation or skew), so the
 * axis-aligned box it returns IS the SVG's on-screen box.
 *
 * Both canvases keep the default `preserveAspectRatio` (xMidYMid meet): the viewBox is scaled to
 * fit and centred in whatever letterboxing is left over.
 *
 * Returns null when the SVG isn't laid out yet (e.g. jsdom, or a pre-paint frame) — callers should
 * just ignore the event in that case.
 */
export function clientToBoardPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const box = svg.viewBox?.baseVal;
  if (!box || box.width <= 0 || box.height <= 0) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scale = Math.min(rect.width / box.width, rect.height / box.height);
  const left = rect.left + (rect.width - box.width * scale) / 2;
  const top = rect.top + (rect.height - box.height * scale) / 2;
  return { x: box.x + (clientX - left) / scale, y: box.y + (clientY - top) / scale };
}
