import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { CardColor as PbCardColor, Phase, type GameSnapshot } from '@trm/proto';
import { tokenForPb } from '../game/cards';
import { handFromCounts, handTotal } from '../game/payments';
import { LOCOMOTIVE_GRADIENT } from '../theme/colors';
import { useAnimationsStore } from '../store/animations';

interface Props {
  snapshot: GameSnapshot;
  canDraw: boolean;
  onDrawFaceUp(slot: number): void;
  onDrawBlind(): void;
}

export function CardMarket({ snapshot, canDraw, onDrawFaceUp, onDrawBlind }: Props) {
  const { t } = useTranslation();
  const marketFlips = useAnimationsStore((s) => s.marketFlips);
  const clearMarketFlip = useAnimationsStore((s) => s.clearMarketFlip);
  const coveredSlots = useAnimationsStore((s) => s.coveredMarketSlots);
  // A blind draw is legal while ANY card remains in the draw pool: an empty deck reshuffles the
  // discard back in. Gating on deckCount alone hard-locks a player late-game (deck spent, discard
  // full of claimed cards). The engine guarantees DRAWING_CARDS is never entered unless a second
  // draw is actually possible (blind pool or a non-loco face-up card), so gating on drawPool alone
  // is safe here too — if the pool is empty mid-draw, a market slot is always the legal escape.
  const drawPool = snapshot.deckCount + handTotal(handFromCounts(snapshot.discard));
  const isSecondDraw = snapshot.phase === Phase.DRAWING_CARDS;
  return (
    <div className="market">
      <button
        className="deck"
        data-anim="deck"
        disabled={!canDraw || drawPool === 0}
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
          // The wild loco is "any colour" — paint it with the rainbow wash, not its flat grey hex.
          const isLoco = tok?.key === 'LOCOMOTIVE';
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
              // A face-up Locomotive may not be taken as the second draw (engine rule).
              disabled={!canDraw || empty || (isSecondDraw && isLoco)}
              onClick={() => onDrawFaceUp(slot)}
              onAnimationEnd={() => clearMarketFlip(slot)}
              style={
                covered || empty
                  ? undefined
                  : { background: isLoco ? LOCOMOTIVE_GRADIENT : tok.hex, color: tok.ink }
              }
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
