// Single-vs-double tap discrimination for the board, in plain JS on the confirmed-tap stream.
// This deliberately replaces a second numberOfTaps(2) recognizer composed via Gesture.Exclusive:
// that construct DROPS taps on iOS. RNGH's RNTapHandler schedules its maxDuration `cancel` at
// touch-BEGIN and never clears it at touch end, while UIKit holds the exclusive single tap's
// recognition pending until the double-tap fails (release + its 200ms default maxDelay) — so any
// tap held longer than maxDuration − 200ms was silently cancelled before it could deliver. With
// the board's old 250ms maxDuration that was nearly every real finger tap (80–150ms), which is
// why taps barely registered on device; ~40ms mouse/simulator clicks squeaked through. Android
// clears the timer before activating (TapGestureHandler.endTap) and was never affected.
import type { CameraState } from './camera';

/** A second tap within this window (and slop) of the previous one is a double-tap. */
export const DOUBLE_TAP_MS = 250;
export const DOUBLE_TAP_SLOP_PX = 40;

export interface TapArbiter {
  /** Feed one confirmed tap (screen point + the camera at tap time). */
  tap(x: number, y: number, cam: CameraState): void;
  /** Drop any pending single tap (unmount). */
  dispose(): void;
}

/** Each tap either upgrades the pending one to `onDouble`, or arms itself and dispatches via
 *  `onSingle` when the window closes. The camera rides along from tap time, so a glide starting
 *  inside the window can't skew the eventual hit-test. */
export function createTapArbiter(handlers: {
  onSingle(screen: { x: number; y: number }, cam: CameraState): void;
  onDouble(x: number, y: number): void;
  /** Clock override for tests. */
  now?: () => number;
}): TapArbiter {
  const now = handlers.now ?? Date.now;
  let pending: {
    x: number;
    y: number;
    at: number;
    cam: CameraState;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  return {
    tap(x, y, cam) {
      const prev = pending;
      if (prev) {
        clearTimeout(prev.timer);
        pending = null;
        if (
          now() - prev.at <= DOUBLE_TAP_MS &&
          Math.hypot(x - prev.x, y - prev.y) <= DOUBLE_TAP_SLOP_PX
        ) {
          handlers.onDouble(x, y);
          return;
        }
        // A far-apart (or timer-starved late) second tap: the first was a genuine single tap.
        handlers.onSingle({ x: prev.x, y: prev.y }, prev.cam);
      }
      const timer = setTimeout(() => {
        pending = null;
        handlers.onSingle({ x, y }, cam);
      }, DOUBLE_TAP_MS);
      pending = { x, y, at: now(), cam, timer };
    },
    dispose() {
      if (pending) {
        clearTimeout(pending.timer);
        pending = null;
      }
    },
  };
}
