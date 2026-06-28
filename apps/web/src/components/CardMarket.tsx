import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { CardColor as PbCardColor, type GameSnapshot } from '@trm/proto';
import { tokenForPb } from '../game/cards';
import { useAnimations } from '../store/animations';

interface Props {
  snapshot: GameSnapshot;
  canDraw: boolean;
  onDrawFaceUp(slot: number): void;
  onDrawBlind(): void;
}

export function CardMarket({ snapshot, canDraw, onDrawFaceUp, onDrawBlind }: Props) {
  const { t } = useTranslation();
  const marketFlips = useAnimations((s) => s.marketFlips);
  const clearMarketFlip = useAnimations((s) => s.clearMarketFlip);
  const coveredSlots = useAnimations((s) => s.coveredMarketSlots);
  return (
    <div className="market">
      <button
        className="deck"
        data-anim="deck"
        disabled={!canDraw || snapshot.deckCount === 0}
        onClick={onDrawBlind}
        title={t('drawBlind')}
      >
        <Layers size={20} aria-hidden />
        <span>{snapshot.deckCount}</span>
      </button>
      <div className="market-slots">
        {snapshot.market.map((card, slot) => {
          const tok = tokenForPb(card);
          const empty = card === PbCardColor.UNSPECIFIED || !tok;
          // A covered slot has a real (refilled) card underneath but stays face-down until the
          // active draw resolves — still drawable, just not yet revealed.
          const covered = coveredSlots.has(slot);
          return (
            <button
              key={slot}
              className={
                'market-slot' +
                (covered ? ' is-covered' : '') +
                (marketFlips.has(slot) ? ' is-flipping' : '')
              }
              data-anim="market-slot"
              data-slot={slot}
              disabled={!canDraw || empty}
              onClick={() => onDrawFaceUp(slot)}
              onAnimationEnd={() => clearMarketFlip(slot)}
              style={covered || empty ? undefined : { background: tok.hex, color: tok.ink }}
              aria-label={covered ? t('drawBlind') : tok ? tok.nameZh : 'empty'}
            >
              {covered ? <Layers size={18} aria-hidden /> : tok ? tok.glyph : '·'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
