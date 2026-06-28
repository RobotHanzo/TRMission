import { Train } from 'lucide-react';
import type { CardColor } from '@trm/shared';
import { CARD_COLOR_TOKENS } from '../theme/colors';

/**
 * The face of a card mid-flight. Your own draws show the real card colour; an opponent's
 * draw shows a branded cover (you don't get to see what they drew).
 */
export function FlyingCard({ color }: { color: CardColor | null }) {
  if (!color) {
    return (
      <>
        <Train className="flying-card-cover-mark" size={18} aria-hidden />
        <span className="flying-card-cover-name" aria-hidden>
          台鐵任務
        </span>
      </>
    );
  }
  const tok = CARD_COLOR_TOKENS[color];
  return (
    <span className="flying-card-face" style={{ background: tok.hex, color: tok.ink }} aria-hidden>
      {tok.glyph}
    </span>
  );
}
