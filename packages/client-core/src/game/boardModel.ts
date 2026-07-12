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
