/** The axis-aligned extent of a station selection, in board units, plus its centre — the group's
 *  anchor. The Stops stage's canvas draws the dashed frame from it and the "move selected" click
 *  lands `cx`/`cy` on the clicked point, so both surfaces agree on what "the group's position"
 *  means: the centre of what you can see selected, not a weighted average that drifts toward
 *  whichever end of the map holds more stations. */
export interface SelectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
}

export function selectionBounds(
  points: readonly { readonly x: number; readonly y: number }[],
): SelectionBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
