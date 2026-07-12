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
      if (alive) setRects(next);
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
