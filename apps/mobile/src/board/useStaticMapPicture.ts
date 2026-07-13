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
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Skia,
  drawAsPicture,
  type SkImage,
  type SkPicture,
  type SkRect,
} from '@shopify/react-native-skia';
import type { RasterSpec } from './camera';

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
        if (cancelled) {
          pic.dispose?.();
          return;
        }
        setPicture(pic);
      })
      .catch(() => {
        // Recording is a cache, not a dependency — on failure the caller keeps showing the live
        // tree (either the previous picture, or the fallback if none was ever produced).
      });
    return () => {
      cancelled = true;
    };
  }, deps);

  // Release the REPLACED picture's native command buffer once the swap has committed (the old
  // one is out of the sksg tree by the time this effect runs); the final one on unmount.
  const prevPicture = useRef<SkPicture | null>(null);
  useEffect(() => {
    if (prevPicture.current && prevPicture.current !== picture) prevPicture.current.dispose?.();
    prevPicture.current = picture;
  }, [picture]);
  useEffect(
    () => () => {
      prevPicture.current?.dispose?.();
      prevPicture.current = null;
    },
    [],
  );

  return picture;
}

/** A rasterized snapshot of the static map picture + the board-space rect it covers. The rect is
 *  captured WITH the image (not read from the live spec) so a snapshot that hasn't caught up with
 *  a newer spec yet still draws exactly where it was rendered for. */
export interface StaticMapRaster {
  image: SkImage;
  rect: RasterSpec['rect'];
}

/**
 * Rasterizes the cached static Picture into an offscreen GPU texture snapshot, re-rendered only
 * at camera settles (the spec changes) or when the scene content re-records (the picture
 * changes) — never mid-motion. While the camera moves the board draws THIS image as a single
 * textured quad per frame instead of re-rasterizing the whole vector scene at up to 120Hz; the
 * crisp vector picture takes back over the moment the camera settles. This is the same
 * texture-compositing trick the browser gives the web board for free, which is why the same
 * device pans the web version smoothly. Guarded like the picture cache above: environments
 * without `Skia.Surface.MakeOffscreen` (the jest mock) simply never produce a snapshot and the
 * caller keeps drawing vectors — a performance cache, never a correctness dependency.
 */
export function useStaticMapImage(
  picture: SkPicture | null,
  spec: RasterSpec | null | undefined,
): StaticMapRaster | null {
  const [raster, setRaster] = useState<StaticMapRaster | null>(null);

  // Release the REPLACED snapshot's pixels once the swap has committed — each snapshot is a
  // full-resolution RGBA bitmap (tens of MB at settle), and without an explicit dispose the
  // native memory piles up per settle until GC catches up (the observed ~67MB/settle growth).
  const prevRaster = useRef<StaticMapRaster | null>(null);
  useEffect(() => {
    if (prevRaster.current && prevRaster.current !== raster) prevRaster.current.image.dispose?.();
    prevRaster.current = raster;
  }, [raster]);
  useEffect(
    () => () => {
      prevRaster.current?.image.dispose?.();
      prevRaster.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!picture || !spec) return;
    if (typeof Skia.Surface?.MakeOffscreen !== 'function') return; // no offscreen GPU — stay live
    let cancelled = false;
    // Deferred a tick so the settle re-render (and its picture re-record) commits first — the
    // raster is one blocking JS pass, taken while the user is idle and the vectors are on screen.
    const id = setTimeout(() => {
      if (cancelled) return;
      try {
        const w = Math.max(1, Math.round(spec.rect.w * spec.pxPerUnit));
        const h = Math.max(1, Math.round(spec.rect.h * spec.pxPerUnit));
        const surface = Skia.Surface.MakeOffscreen(w, h);
        if (!surface) return;
        const canvas = surface.getCanvas();
        canvas.scale(spec.pxPerUnit, spec.pxPerUnit);
        canvas.translate(-spec.rect.x, -spec.rect.y);
        canvas.drawPicture(picture);
        surface.flush();
        // makeNonTextureImage: the offscreen surface has its own GPU context, so hand the
        // renderer a context-free copy (RNSkia's drawAsImageFromPicture does the same).
        const snap = surface.makeImageSnapshot();
        const image = snap.makeNonTextureImage();
        snap.dispose();
        surface.dispose();
        if (image && !cancelled) setRaster({ image, rect: spec.rect });
        else image?.dispose?.(); // unmounted (or spec changed) mid-raster — don't leak the copy
      } catch {
        // Rasterizing is a cache, not a dependency — on failure the caller keeps the previous
        // snapshot (or draws the vector picture during motion if none was ever produced).
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [picture, spec]);

  return raster;
}
