import { TRAIN_COLORS, type CardColor } from '@trm/shared';
import { CARD_COLOR_TOKENS } from '../theme/colors';
import { rgba } from '../theme/shade';
import { TrainCarArt } from './TrainCarArt';

// Wild = any colour: the eight liveries as a gradient band across the loco card's edge.
const WILD_EDGE = `linear-gradient(90deg, ${TRAIN_COLORS.map((c) => CARD_COLOR_TOKENS[c].hex).join(', ')})`;

interface Props {
  color: CardColor;
  count?: number;
  /** Show the colour-blind glyph chip. */
  showGlyph?: boolean;
}

/**
 * A board-game-sized train-car card: the original rolling-stock artwork on a
 * livery-tinted "ticket" face with a brass frame. A count chip and a stacked-deck
 * shadow communicate how many of the colour you hold; the glyph chip keeps it
 * readable in colour-blind mode.
 */
// Faint rainbow wash for the wild card, so the whole face reads "any colour".
const WILD_WASH = `linear-gradient(150deg, ${TRAIN_COLORS.slice(0, 6)
  .map((c) => rgba(CARD_COLOR_TOKENS[c].hex, 0.2))
  .join(', ')})`;

export function TrainCarCard({ color, count, showGlyph = true }: Props) {
  const tok = CARD_COLOR_TOKENS[color];
  const isLoco = color === 'LOCOMOTIVE';
  const stacked = (count ?? 0) > 1;
  return (
    <div
      className={`train-card${stacked ? ' is-stacked' : ''}${isLoco ? ' is-loco' : ''}`}
      style={{
        // Livery wash over the theme surface — works in light and dark.
        background: isLoco
          ? `${WILD_WASH}, var(--tr-surface)`
          : `linear-gradient(160deg, ${rgba(tok.hex, 0.2)}, ${rgba(tok.hex, 0.05)}), var(--tr-surface)`,
      }}
      title={tok.nameZh}
      role="img"
      aria-label={`${tok.nameZh}${count !== undefined ? ` ×${count}` : ''}`}
    >
      <span
        className="train-card-edge"
        style={{ background: isLoco ? WILD_EDGE : tok.hex }}
        aria-hidden
      />
      <TrainCarArt color={color} />
      {isLoco && <span className="train-card-gloss" aria-hidden />}
      {showGlyph && (
        <span className="train-card-glyph" style={{ background: tok.hex, color: tok.ink }} aria-hidden>
          {tok.glyph}
        </span>
      )}
      {count !== undefined && <span className="train-card-count">×{count}</span>}
    </div>
  );
}
