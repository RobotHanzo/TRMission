import type { RefObject } from 'react';
import { useTransformEffect } from 'react-zoom-pan-pinch';
import { zoomBucket } from '../../../game/lod';

/** Mirrors the live board's ZoomTracker onto a builder canvas: `--inv-scale` and `--marker-scale`
 *  (both ≈ functions of 1/zoom, clamped) so labels/stroke weight counter-scale and station markers
 *  grow exactly as they do in-game, plus `data-zoom` — the level-of-detail bucket that thins the
 *  labels out as you pull back (game.css). Without the bucket every station name renders at every
 *  zoom, which buries a map the game would have shown as majors only. Must render as a sibling of
 *  `TransformComponent`, inside `TransformWrapper`. */
export function ZoomVar({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  useTransformEffect(({ state }) => {
    const el = targetRef.current;
    if (!el) return;
    const s = state.scale;
    el.dataset.zoom = zoomBucket(s);
    el.style.setProperty('--inv-scale', String(Math.max(0.12, Math.min(1.5, 1 / s))));
    el.style.setProperty(
      '--marker-scale',
      String(Math.max(0.34, Math.min(0.82, 1 / Math.sqrt(s)))),
    );
  });
  return null;
}
