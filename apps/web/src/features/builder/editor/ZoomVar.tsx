import type { RefObject } from 'react';
import { useTransformEffect } from 'react-zoom-pan-pinch';
import { zoomBucket } from '../../../game/lod';

/**
 * How heavily a builder canvas inks the cartography, as a fraction of the live board's weight.
 *
 * The board's counter-scaling pins every glyph to a constant ON-SCREEN size (≈ label px = 4 ×
 * viewport/viewBox), so it never tracks the zoom — it tracks how big the surface is. Those weights
 * are calibrated for a player zoomed into one corridor. Authoring is the opposite posture: you sit
 * zoomed out over the whole map, where full-weight names cover the network they are naming (a
 * 47-station map at fit is a wall of 30px text). Same shapes, same counter-scaling, less ink.
 *
 * This is the one deliberate departure from "the canvas previews exactly as it will play" — the
 * layout it previews is exact, the ink is lighter. Raise toward 1 for a heavier canvas.
 */
const EDITOR_MAP_WEIGHT = 0.72;

/** Mirrors the live board's ZoomTracker onto a builder canvas: `--inv-scale` and `--marker-scale`
 *  (both ≈ functions of 1/zoom, clamped, then taken down to `EDITOR_MAP_WEIGHT`) so labels/stroke
 *  weight counter-scale and station markers grow as they do in-game, plus `data-zoom` — the
 *  level-of-detail bucket that thins the labels out as you pull back (game.css). Without the
 *  bucket every station name renders at every zoom, which buries a map the game would have shown
 *  as majors only. Must render as a sibling of `TransformComponent`, inside `TransformWrapper`. */
export function ZoomVar({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  useTransformEffect(({ state }) => {
    const el = targetRef.current;
    if (!el) return;
    const s = state.scale;
    el.dataset.zoom = zoomBucket(s);
    // Clamp first, then weight: the clamps are the board's (they bound how far a glyph may drift
    // from its base size), and the weight is a flat trim applied to whatever they allow.
    const inv = Math.max(0.12, Math.min(1.5, 1 / s));
    const marker = Math.max(0.34, Math.min(0.82, 1 / Math.sqrt(s)));
    el.style.setProperty('--inv-scale', String(inv * EDITOR_MAP_WEIGHT));
    el.style.setProperty('--marker-scale', String(marker * EDITOR_MAP_WEIGHT));
  });
  return null;
}
