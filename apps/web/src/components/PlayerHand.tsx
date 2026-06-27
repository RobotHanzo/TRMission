import { CARD_COLORS } from '@trm/shared';
import type { CardCounts } from '@trm/proto';
import { handFromCounts } from '../game/payments';
import { CardSwatch } from './CardSwatch';

export function PlayerHand({ hand }: { hand: CardCounts | undefined }) {
  const h = handFromCounts(hand);
  const present = CARD_COLORS.filter((c) => h[c] > 0);
  return (
    <div className="hand">
      {present.length === 0 ? (
        <span className="muted">—</span>
      ) : (
        present.map((c) => <CardSwatch key={c} color={c} count={h[c]} />)
      )}
    </div>
  );
}
