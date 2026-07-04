/** Pure pointer→bow math for the Curves stage, kept out of the component so it's testable in
 *  jsdom (where SVG CTMs don't exist). Sign convention matches @trm/map-data's geometry:
 *  the chord normal is (-dy, dx)/len for the a→b chord. */

export function bowFromPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  return ((p.x - midX) * -dy + (p.y - midY) * dx) / len;
}
