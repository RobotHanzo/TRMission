// Native spotlight measurement: hud anchors resolve through the TutorialTargetRegistry
// (measureInWindow); cities/routes are computed from board geometry projected through the live
// camera. Mirrors the web hook's semantics: re-measure for a short window after each beat change
// so the holes track the board's auto-pan glide; a named-but-unresolved target yields NO rects.
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import type { Spotlight } from './types';
import { selectorsForSpotlight, type FlatRect } from './focus';
import { TUTORIAL_ANCHORS, useTutorialTargets } from './targets';
import { boardAnchorRects } from './boardRects';
import { useBoardCameraReader, type ReadBoardCamera } from './cameraBridge';
import { cityById, routeById } from '../../game/content';

/** How long after a beat change to keep re-measuring (web: rAF window of the same length —
 *  covers the 600ms auto-pan glide with slack). */
const TRACK_MS = 700;
/** HUD-anchor poll cadence: HUD targets don't glide, so the native measureInWindow round-trip
 *  only re-runs occasionally within the window (board targets track per-frame instead). */
const TRACK_INTERVAL_MS = 80;
/** Stop the HUD poll early once this many consecutive measurements agree — the target is static,
 *  so further native round-trips and their downstream re-renders would be pure waste. */
const SETTLE_STREAK = 2;

function rectsEqual(a: readonly FlatRect[], b: readonly FlatRect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i]!;
    const rb = b[i]!;
    if (ra.x !== rb.x || ra.y !== rb.y || ra.w !== rb.w || ra.h !== rb.h) return false;
  }
  return true;
}

export function useSpotlightRects(
  spotlight: Spotlight | undefined,
  readCamera?: ReadBoardCamera,
): FlatRect[] {
  const targets = useTutorialTargets();
  const defaultReader = useBoardCameraReader();
  const read = readCamera ?? defaultReader;
  const { width, height } = useWindowDimensions();
  const [rects, setRects] = useState<FlatRect[]>([]);
  // Stable key: refire on the beat's spotlight, not on every parent render (same as web).
  const key = spotlight ? JSON.stringify(spotlight) : '';

  useEffect(() => {
    // `board` + undefined intentionally resolve to no selectors (whole-stage dim is the caller's
    // dimAll decision) — identical to the web's selectorsForSpotlight contract.
    if (!spotlight || selectorsForSpotlight(spotlight).length === 0) {
      setRects([]);
      return;
    }
    let alive = true;
    let last: FlatRect[] | null = null;
    const started = Date.now();
    const push = (next: FlatRect[]): void => {
      if (!alive || (last && rectsEqual(last, next))) return;
      last = next;
      setRects(next);
    };

    // ── HUD anchors: static views — a settle-gated 80ms poll is plenty ──
    if (spotlight.kind === 'hud') {
      let settledStreak = 0;
      const measure = async (): Promise<void> => {
        const next = await targets.measure(spotlight.selector);
        if (!alive) return;
        if (last && rectsEqual(last, next)) {
          settledStreak++;
          if (settledStreak >= SETTLE_STREAK) clearInterval(id);
          return;
        }
        settledStreak = 0;
        last = next;
        setRects(next);
      };
      void measure();
      const id = setInterval(() => {
        if (Date.now() - started > TRACK_MS) {
          clearInterval(id);
          return;
        }
        void measure();
      }, TRACK_INTERVAL_MS);
      return () => {
        alive = false;
        clearInterval(id);
      };
    }

    if (spotlight.kind !== 'cities' && spotlight.kind !== 'route') {
      setRects([]); // 'board' never reaches here (no selectors above) — defensive for new kinds
      return;
    }

    // ── Board anchors: glide with the camera's auto-pan, so track at native frame rate. The
    // board viewport itself is STATIC while the camera moves inside it — measure it once, then
    // re-project from the live camera every frame with no further native round-trips (previously
    // this re-measured over an 80ms interval, which made the hole hop at 12.5Hz through the
    // glide). setState still only fires when a rect actually moved. ──
    let boardRect: FlatRect | null = null;
    let raf = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const tick = (): void => {
      if (!alive) return;
      const cam = read();
      push(cam ? boardAnchorRects(spotlight, cityById, routeById, cam, boardRect!) : []);
      if (Date.now() - started <= TRACK_MS) raf = requestAnimationFrame(tick);
    };
    const resolveBoard = (): void => {
      void targets.measure(TUTORIAL_ANCHORS.board).then(([board]) => {
        if (!alive) return;
        if (board) {
          boardRect = board;
          tick();
        } else if (Date.now() - started <= TRACK_MS) {
          retry = setTimeout(resolveBoard, TRACK_INTERVAL_MS); // board still mounting — try again
        } else {
          push([]); // named-but-unresolved → no rects (never a bogus dim)
        }
      });
    };
    resolveBoard();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (retry !== null) clearTimeout(retry);
    };
    // width/height in deps: an orientation change / split-screen resize re-measures (web: resize
    // listener). `key` stands in for `spotlight` so a parent re-render can't refire the effect.
  }, [key, targets, read, width, height]);
  return rects;
}
