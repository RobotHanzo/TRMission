import type { TrainColor } from '@trm/shared';
import type { Hand, Payment } from './payments';

// Reveal timing — web's `.tunnel-reveal-card` (animations.css) and mobile's flip-in both key
// off these (0.5s stagger, 0.6s flip), so the per-card sound ticks stay in sync on both.
export const REVEAL_STAGGER_MS = 500;
export const REVEAL_FLIP_MS = 600;

/** How long (ms) `TunnelModal` takes to flip in `revealedCount` cards and show the surcharge
 *  result — 0 under reduced motion, where the result appears instantly. Shared with the replay
 *  player so autoplay can hold a tunnel-reveal frame on screen instead of racing ahead of it. */
export function tunnelRevealMs(revealedCount: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return Math.max(0, revealedCount - 1) * REVEAL_STAGGER_MS + REVEAL_FLIP_MS + 120;
}

/** Valid extra payments for a tunnel surcharge — extra colour must match the played colour. */
export function enumerateTunnelExtra(
  hand: Hand,
  playedColor: TrainColor | null,
  need: number,
): Payment[] {
  const out: Payment[] = [];
  for (let loco = 0; loco <= need; loco++) {
    if (hand.LOCOMOTIVE < loco) continue;
    const colorCount = need - loco;
    if (colorCount === 0) {
      out.push({ color: null, colorCount: 0, locomotives: loco });
      continue;
    }
    if (playedColor && hand[playedColor] >= colorCount) {
      out.push({ color: playedColor, colorCount, locomotives: loco });
    }
  }
  return out;
}
