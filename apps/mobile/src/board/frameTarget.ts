// A board auto-pan target + its glide duration — ported from apps/web/src/game/boardView.ts:18-28
// (the rest of that file is web-only react-zoom-pan-pinch pixel↔board bridging; mobile models the
// camera natively in board units, so only this screen-independent target model carries over).

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
