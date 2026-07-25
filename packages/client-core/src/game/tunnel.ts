import { useCallback, useState } from 'react';
import { Phase, type GameSnapshot } from '@trm/proto';
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

/**
 * Whether the pending tunnel reveal belongs on screen, plus its own dismissal for `readOnly`
 * (playback) callers.
 *
 * A replay passes no `commands`, so the dialog's payment/abort buttons resolve nothing — and its
 * backdrop covers the whole viewport, replay transport included. Stepping onto a `TUNNEL_PENDING`
 * frame therefore used to leave the viewer stuck behind a dialog with no way out (issue #45). In
 * `readOnly` mode the reveal gets a Close of its own, scoped to the pending tunnel: the next
 * reveal — or the same one re-reached after seeking away — opens normally.
 */
export function useTunnelReveal(
  snapshot: GameSnapshot,
  readOnly: boolean,
): { visible: boolean; dismiss: () => void } {
  const pending = snapshot.phase === Phase.TUNNEL_PENDING ? snapshot.pendingTunnel : undefined;
  const key = pending ? `${pending.playerId}@${pending.routeId}` : null;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // Dropped during render (React's derived-state reset) rather than from an effect, so a reveal
  // that has moved on can never flash the dismissed dialog back for a frame.
  if (dismissedKey !== null && dismissedKey !== key) setDismissedKey(null);
  const dismiss = useCallback(() => setDismissedKey(key), [key]);
  return { visible: pending !== undefined && !(readOnly && dismissedKey === key), dismiss };
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
