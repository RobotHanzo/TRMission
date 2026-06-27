import type { CardColor } from '@trm/shared';
import { CARD_COLOR_TOKENS } from '../theme/colors';

interface Props {
  color: CardColor;
  count?: number;
  showGlyph?: boolean;
  size?: number;
}

/** A single train-card chip. Always carries its glyph for colour-blind readability. */
export function CardSwatch({ color, count, showGlyph = true, size = 30 }: Props) {
  const tok = CARD_COLOR_TOKENS[color];
  return (
    <span
      className="swatch"
      style={{ background: tok.hex, color: tok.ink, width: size, height: size }}
      title={tok.nameZh}
      aria-label={`${tok.nameZh}${count !== undefined ? ` ×${count}` : ''}`}
    >
      <span className="swatch-glyph">{showGlyph ? tok.glyph : ''}</span>
      {count !== undefined && <span className="swatch-count">{count}</span>}
    </span>
  );
}
