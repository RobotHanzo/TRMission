import { useTranslation } from 'react-i18next';
import { CARD_COLORS } from '@trm/shared';
import type { CardCounts } from '@trm/proto';
import { handFromCounts } from '../game/payments';
import { TrainCarCard } from './TrainCarCard';

/** The player's hand as a row of big train-car cards, one per colour held. */
export function PlayerHand({ hand }: { hand: CardCounts | undefined }) {
  const { t } = useTranslation();
  const h = handFromCounts(hand);
  const present = CARD_COLORS.filter((c) => h[c] > 0);
  return (
    <div className="hand">
      {present.length === 0 ? (
        <span className="muted">{t('noCards')}</span>
      ) : (
        present.map((c) => <TrainCarCard key={c} color={c} count={h[c]} />)
      )}
    </div>
  );
}
