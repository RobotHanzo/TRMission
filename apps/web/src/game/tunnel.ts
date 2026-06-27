import type { TrainColor } from '@trm/shared';
import type { Hand, Payment } from './payments';

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
