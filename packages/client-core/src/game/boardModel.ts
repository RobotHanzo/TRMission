// The screen-independent board-view model both clients share: a wire-shaped viewport framing and
// the auto-pan target. Everything pixel-related stays platform-side (web: react-zoom-pan-pinch
// bridging in game/boardView.ts; mobile: the Reanimated camera in board/camera.ts — its
// CameraState is structurally this ViewDescriptor).

/** A viewport framing in board units — what we put on the wire (`CameraView`). */
export interface ViewDescriptor {
  /** Board x (0–100 space) under the viewport centre. */
  cx: number;
  /** Board y (0–100 space) under the viewport centre. */
  cy: number;
  /** How many board units span the viewport WIDTH (the zoom metric). */
  span: number;
}

/** A rectangle in board units (the 0–100 city space). */
export interface BoardBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Margin kept around the stops in the home frame: room for city labels, bowed routes and the
 *  station ring drawn over a marker. */
export const HOME_PAD = 4;

/**
 * What the home/reset view frames: the playable NETWORK — the bounding box of every mainland
 * stop, padded — and NOT the cartography under it. A map's land routinely runs far past the
 * rails it carries (both Taipei maps crop whole counties, so their land keeps an empty plain to
 * the west and a mountain block to the south), and framing that leaves the railways small and
 * off-centre, which is what issue #71 reported for 大臺北軌道交通. Island stops sit alone out in
 * the sea and would drag the frame straight back out to the whole crop, so they don't count —
 * Taiwan's Kinmen/Matsu/Orchid still land on screen through the fit's own margins.
 *
 * `fallback` (the map's `baseView`) covers content with nothing to frame yet — a builder draft
 * before its first stop.
 */
export function homeBounds(
  cities: readonly { x: number; y: number; isIsland?: boolean | undefined }[],
  fallback: BoardBounds,
): BoardBounds {
  const mainland = cities.filter((c) => !c.isIsland);
  const pts = mainland.length > 0 ? mainland : cities;
  if (pts.length === 0) return { ...fallback };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of pts) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return {
    x: minX - HOME_PAD,
    y: minY - HOME_PAD,
    w: maxX - minX + 2 * HOME_PAD,
    h: maxY - minY + 2 * HOME_PAD,
  };
}

/** A board auto-pan target: a set of route ids or city ids to frame. */
export interface BoardFrameTarget {
  kind: 'route' | 'cities';
  ids: string[];
  /** Skip the glide and snap straight to the target (used by replay seeks/jumps). */
  instant?: boolean;
}

/** The auto-pan transform duration (ms) for `target`: instant/reduced-motion snap to 0, else glide. */
export function frameDurationMs(target: BoardFrameTarget, reducedMotion: boolean): number {
  return target.instant || reducedMotion ? 0 : 600;
}
