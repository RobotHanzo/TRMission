import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardColor as PbCardColor } from '@trm/proto';
import { tokenForPb } from '../game/cards';
import type { Payment } from '../game/payments';
import { CardSwatch } from './CardSwatch';

interface Props {
  revealed: PbCardColor[];
  extraRequired: number;
  options: Payment[];
  onCommit(p: Payment): void;
  onAbort(): void;
}

export function TunnelModal({ revealed, extraRequired, options, onCommit, onAbort }: Props) {
  const { t } = useTranslation();
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <h3>{t('tunnel')}</h3>
        <div className="row reveal">
          {revealed.map((c, i) => {
            const tok = tokenForPb(c);
            return (
              <span
                key={i}
                className="reveal-card"
                style={
                  {
                    '--i': i,
                    ...(tok ? { background: tok.hex, color: tok.ink } : {}),
                  } as CSSProperties
                }
              >
                {tok ? tok.glyph : '·'}
              </span>
            );
          })}
        </div>
        <p>{t('payExtra', { n: extraRequired })}</p>
        {options.length === 0 ? (
          <p className="muted">{t('cannotAfford')}</p>
        ) : (
          <ul className="payment-options">
            {options.map((p, i) => (
              <li key={i}>
                <button onClick={() => onCommit(p)}>
                  {p.color && p.colorCount > 0 && (
                    <CardSwatch color={p.color} count={p.colorCount} size={24} />
                  )}
                  {p.locomotives > 0 && (
                    <CardSwatch color="LOCOMOTIVE" count={p.locomotives} size={24} />
                  )}
                  {extraRequired === 0 && <span>{t('confirm')}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={onAbort}>{t('abort')}</button>
      </div>
    </div>
  );
}
