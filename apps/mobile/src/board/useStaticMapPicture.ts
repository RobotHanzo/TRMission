// Caches MapSceneSkia's static content (geography + routes + cities + labels) into one recorded
// Skia Picture, re-recorded only when that content actually changes — NOT on every animation
// frame. Why this matters: RNSkia's Reanimated integration replays every draw command in the live
// scene on every frame any shared value in it ticks (sksg/Recorder/Player.ts's `replay`), and the
// board's entire static network sits inside the camera's animated `<Group transform>` (BoardView).
// An uncached ~40-city/~70-route/label scene therefore re-issues several hundred Skia draw calls
// at up to 120Hz for the whole duration of a pan or pinch gesture — that per-frame replay cost,
// not JS re-rendering (MapSceneSkia's props are untouched by a gesture), is what drops FPS. Folding
// the static subtree into a Picture collapses that per-frame cost to a single `drawPicture` replay,
// mirroring RNSkia's own `useTexture` recipe but stopping at the vector Picture (not a rasterized
// bitmap) so the map stays crisp at every zoom level instead of blurring past the caching
// resolution. Guarded exactly like BoardText's Paragraph usage: an environment without
// `Skia.PictureRecorder` (the jest mock) simply never produces a picture, so the caller's live
// fallback renders — this is a performance cache, never a correctness dependency.
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Skia, drawAsPicture, type SkPicture, type SkRect } from '@shopify/react-native-skia';

export function useStaticMapPicture(
  element: ReactElement,
  bounds: SkRect,
  deps: readonly unknown[],
): SkPicture | null {
  const [picture, setPicture] = useState<SkPicture | null>(null);

  useEffect(() => {
    if (typeof Skia.PictureRecorder !== 'function') return; // no offscreen recorder — stay live
    let cancelled = false;
    drawAsPicture(element, bounds)
      .then((pic) => {
        if (!cancelled) setPicture(pic);
      })
      .catch(() => {
        // Recording is a cache, not a dependency — on failure the caller keeps showing the live
        // tree (either the previous picture, or the fallback if none was ever produced).
      });
    return () => {
      cancelled = true;
    };
  }, deps);

  return picture;
}
