import { useTranslation } from 'react-i18next';
import type { Payment } from '../game/payments';
import { CardSwatch } from './CardSwatch';

interface Props {
  title: string;
  options: Payment[];
  onPick(p: Payment): void;
  onCancel(): void;
}

/** Lets the player choose which combination of cards to spend. */
export function PaymentModal({ title, options, onPick, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {options.length === 0 ? (
          <p className="muted">{t('cannotAfford')}</p>
        ) : (
          <ul className="payment-options">
            {options.map((p, i) => (
              <li key={i}>
                <button onClick={() => onPick(p)}>
                  {p.color && p.colorCount > 0 && (
                    <CardSwatch color={p.color} count={p.colorCount} size={24} />
                  )}
                  {p.locomotives > 0 && (
                    <CardSwatch color="LOCOMOTIVE" count={p.locomotives} size={24} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button onClick={onCancel}>{t('back')}</button>
        </div>
      </div>
    </div>
  );
}
