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

/** How long after a beat change to keep re-measuring (web: rAF window of the same length). */
const TRACK_MS = 700;
const TRACK_INTERVAL_MS = 80;
/** Stop polling early once this many consecutive measurements agree — the camera glide (or a
 *  static HUD target that never moves) has settled, so further native measureInWindow round-trips
 *  and their downstream re-renders (the scrim path, the coachmark's own caret re-measure) would be
 *  pure waste for the rest of the tracking window. */
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
    let settledStreak = 0;
    const started = Date.now();

    const measure = async (): Promise<void> => {
      let next: FlatRect[] = [];
      if (spotlight.kind === 'hud') {
        next = await targets.measure(spotlight.selector);
      } else if (spotlight.kind === 'cities' || spotlight.kind === 'route') {
        const [board] = await targets.measure(TUTORIAL_ANCHORS.board);
        const cam = read();
        if (board && cam) next = boardAnchorRects(spotlight, cityById, routeById, cam, board);
      }
      if (!alive) return;
      // Skip the state update (and the re-renders it would cascade into) when the measurement
      // didn't actually move anything — the common case once a glide settles, or for the whole
      // duration of a static HUD spotlight.
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
    // width/height in deps: an orientation change / split-screen resize re-measures (web: resize
    // listener). `key` stands in for `spotlight` so a parent re-render can't refire the effect.
  }, [key, targets, read, width, height]);
  return rects;
}
