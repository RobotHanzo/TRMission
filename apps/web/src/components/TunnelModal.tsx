import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardColor as PbCardColor } from '@trm/proto';
import { CARD_COLOR_TOKENS } from '../theme/colors';
import { pbToCard } from '../game/cards';
import type { Payment } from '../game/payments';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { TrainCarCard } from './TrainCarCard';

interface Props {
  revealed: PbCardColor[];
  extraRequired: number;
  options: Payment[];
  onCommit(p: Payment): void;
  onAbort(): void;
}

// Match the route-claim / station-build payment modal's card size.
const CARD_SIZE = 104;
// Reveal timing, kept in step with `.tunnel-reveal-card` in animations.css (0.5s stagger, 0.6s flip).
const REVEAL_STAGGER_MS = 500;
const REVEAL_FLIP_MS = 600;

/** Describes a spend option for assistive tech, e.g. "藍 ×2 + 機車頭 ×1". */
const describe = (p: Payment): string => {
  const parts: string[] = [];
  if (p.color && p.colorCount > 0)
    parts.push(`${CARD_COLOR_TOKENS[p.color].nameZh} ×${p.colorCount}`);
  if (p.locomotives > 0)
    parts.push(`${CARD_COLOR_TOKENS.LOCOMOTIVE.nameZh} ×${p.locomotives}`);
  return parts.join(' + ');
};

export function TunnelModal({ revealed, extraRequired, options, onCommit, onAbort }: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // Hold the surcharge result + payment choices back until every card has flipped in, so the
  // outcome isn't spoiled before the reveal finishes building suspense.
  const [showResult, setShowResult] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setShowResult(true);
      return;
    }
    setShowResult(false);
    const ms = Math.max(0, revealed.length - 1) * REVEAL_STAGGER_MS + REVEAL_FLIP_MS + 120;
    const timer = window.setTimeout(() => setShowResult(true), ms);
    return () => clearTimeout(timer);
  }, [revealed, reduced]);

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <h3>{t('tunnel')}</h3>
        {/* The three drawn cards flip in one at a time (slow, for suspense). */}
        <div className="tunnel-reveal">
          {revealed.map((c, i) => {
            const color = pbToCard(c);
            if (!color) return null;
            return (
              <div key={i} className="tunnel-reveal-card" style={{ '--i': i } as CSSProperties}>
                <TrainCarCard color={color} size={CARD_SIZE} />
              </div>
            );
          })}
        </div>
        {showResult && (
          <div className="tunnel-result">
            <p className="tunnel-surcharge">
              {extraRequired === 0 ? t('tunnelNoExtra') : t('payExtra', { n: extraRequired })}
            </p>
            {options.length === 0 ? (
              <p className="muted">{t('cannotAfford')}</p>
            ) : (
              <ul className="payment-options card-options">
                {options.map((p, i) => {
                  const hasCards = (p.color && p.colorCount > 0) || p.locomotives > 0;
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        className="payment-card"
                        aria-label={hasCards ? describe(p) : t('confirm')}
                        onClick={() => onCommit(p)}
                      >
                        {p.color && p.colorCount > 0 && (
                          <TrainCarCard color={p.color} count={p.colorCount} size={CARD_SIZE} />
                        )}
                        {p.locomotives > 0 && (
                          <TrainCarCard color="LOCOMOTIVE" count={p.locomotives} size={CARD_SIZE} />
                        )}
                        {!hasCards && <span className="payment-confirm">{t('confirm')}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="row">
              <button type="button" onClick={onAbort}>
                {t('abort')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
