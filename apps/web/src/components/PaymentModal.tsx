import { useTranslation } from 'react-i18next';
import { CARD_COLOR_TOKENS } from '../theme/colors';
import type { Payment } from '../game/payments';
import { TrainCarCard } from './TrainCarCard';

interface Props {
  title: string;
  options: Payment[];
  onPick(p: Payment): void;
  onCancel(): void;
}

// Cards are scaled down from the hand size so a couple of spend-options stack neatly
// in the modal while still reading as the same rolling-stock cards as the deck.
const CARD_SIZE = 104;

/** A truly empty, unmodified payment is the gala zero-cost station. A token-only Bento WILD or
 *  empty repair-permit payment must never be mislabeled as a free station. */
const isFree = (p: Payment): boolean =>
  p.colorCount === 0 &&
  p.locomotives === 0 &&
  !p.bentoSpend &&
  !p.useClaimDiscount &&
  !p.repairPermit;

/** Describes a spend option for assistive tech, e.g. "藍 ×2 + 彩虹車頭 ×1". */
const describe = (p: Payment): string => {
  const parts: string[] = [];
  if (p.color && p.colorCount > 0)
    parts.push(`${CARD_COLOR_TOKENS[p.color].nameZh} ×${p.colorCount}`);
  if (p.locomotives > 0) parts.push(`${CARD_COLOR_TOKENS.LOCOMOTIVE.nameZh} ×${p.locomotives}`);
  return parts.join(' + ');
};

/** Lets the player choose which combination of cards to spend. */
export function PaymentModal({ title, options, onPick, onCancel }: Props) {
  const { t } = useTranslation();
  const modifierLabels = (p: Payment): string[] => [
    ...(p.bentoSpend === 'WILD' ? [t('events.bentoWild')] : []),
    ...(p.bentoSpend === 'POINTS' ? [t('events.bentoPoints')] : []),
    ...(p.useClaimDiscount ? [t('events.perkClaimDiscount')] : []),
    ...(p.allSeatsBonus ? [t('events.allSeatsBonus')] : []),
    ...(p.repairPermit ? [t('events.repairWithPermit')] : []),
  ];
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {options.length === 0 ? (
          <p className="muted">{t('cannotAfford')}</p>
        ) : (
          <ul className="payment-options card-options">
            {options.map((p, i) => (
              <li key={i}>
                {(() => {
                  const modifiers = modifierLabels(p);
                  const aria = [describe(p), ...modifiers].filter(Boolean).join(' · ');
                  return (
                    <button
                      type="button"
                      className={isFree(p) ? 'payment-card payment-free' : 'payment-card'}
                      aria-label={isFree(p) ? t('events.freeStation') : aria}
                      onClick={() => onPick(p)}
                    >
                      {isFree(p) && (
                        <span className="payment-free-label">{t('events.freeStation')}</span>
                      )}
                      {modifiers.length > 0 && (
                        <span className="payment-modifiers">
                          {modifiers.map((label) => (
                            <span key={label} className="payment-modifier">
                              {label}
                            </span>
                          ))}
                        </span>
                      )}
                      {p.color && p.colorCount > 0 && (
                        <TrainCarCard color={p.color} count={p.colorCount} size={CARD_SIZE} />
                      )}
                      {p.locomotives > 0 && (
                        <TrainCarCard color="LOCOMOTIVE" count={p.locomotives} size={CARD_SIZE} />
                      )}
                    </button>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" onClick={onCancel}>
            {t('back')}
          </button>
        </div>
      </div>
    </div>
  );
}
