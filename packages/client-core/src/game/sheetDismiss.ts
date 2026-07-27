/**
 * Swipe-down-to-dismiss for the bottom sheets both clients raise on a phone (issue #65).
 *
 * Only the *decision* lives here — each client owns its own gesture plumbing (a RNGH pan on
 * mobile, pointer events on web). Sharing the thresholds is what keeps the two sheets letting go
 * at the same pull: a sheet that needs a visibly longer drag on one client reads as a stuck panel,
 * not as a different platform.
 */

/** Pull the sheet down this far (in dp/CSS px) and the release dismisses, however slowly. */
export const SHEET_DISMISS_DISTANCE = 88;

/** …or flick faster than this (dp per second) and even a short pull commits. */
export const SHEET_DISMISS_VELOCITY = 700;

/**
 * Should a released drag close the sheet? `dy` is the downward travel (upward drags are ≤ 0 and
 * never dismiss); `velocityY` is the release speed, positive downward.
 */
export function shouldDismissSheet(dy: number, velocityY = 0): boolean {
  if (dy <= 0) return false;
  return dy >= SHEET_DISMISS_DISTANCE || velocityY >= SHEET_DISMISS_VELOCITY;
}

/**
 * How far the sheet follows the finger. Downward travel is 1:1; an upward pull resists instead of
 * lifting the sheet off the bottom edge, which would open a gap over the board behind it.
 */
export function sheetDragOffset(dy: number): number {
  return dy > 0 ? dy : dy / 4;
}
