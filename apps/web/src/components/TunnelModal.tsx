import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardColor as PbCardColor } from '@trm/proto';
import { CARD_COLOR_TOKENS } from '../theme/colors';
import { pbToCard } from '../game/cards';
import type { Payment } from '../game/payments';
import { tunnelRevealMs } from '../game/tunnel';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { TrainCarCard } from './TrainCarCard';
import { soundPlayer } from '../sound/player';

interface Props {
  revealed: PbCardColor[];
  extraRequired: number;
  options: Payment[];
  /** The colour the surcharge must be matched in (UNSPECIFIED for an all-locomotive claim). */
  playedColor?: PbCardColor;
  /** A non-claimant viewer: watches the reveal, but sees only a read-only surcharge combination. */
  spectator?: boolean;
  onCommit(p: Payment): void;
  onAbort(): void;
}

// Match the route-claim / station-build payment modal's card size.
const CARD_SIZE = 104;
// Card-placement tick per revealed tunnel card, synced to the flip stagger.
const REVEAL_STAGGER_MS = 500;

/** Describes a spend option for assistive tech, e.g. "藍 ×2 + 彩虹車頭 ×1". */
const describe = (p: Payment): string => {
  const parts: string[] = [];
  if (p.color && p.colorCount > 0)
    parts.push(`${CARD_COLOR_TOKENS[p.color].nameZh} ×${p.colorCount}`);
  if (p.locomotives > 0) parts.push(`${CARD_COLOR_TOKENS.LOCOMOTIVE.nameZh} ×${p.locomotives}`);
  return parts.join(' + ');
};

export function TunnelModal({
  revealed,
  extraRequired,
  options,
  playedColor,
  spectator = false,
  onCommit,
  onAbort,
}: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // Hold the surcharge result + payment choices back until every card has flipped in, so the
  // outcome isn't spoiled before the reveal finishes building suspense.
  const [showResult, setShowResult] = useState(reduced);
  // Fire the success/payment cue exactly once per opened tunnel.
  const resultCuePlayed = useRef(false);

  useEffect(() => {
    if (reduced) {
      setShowResult(true);
      return;
    }
    setShowResult(false);
    const ms = tunnelRevealMs(revealed.length, reduced);
    const timer = window.setTimeout(() => setShowResult(true), ms);
    return () => clearTimeout(timer);
  }, [revealed, reduced]);

  // Card-placement tick per revealed tunnel card, synced to the flip stagger.
  useEffect(() => {
    if (reduced) {
      soundPlayer.play('tunnelDraw');
      return;
    }
    const timers = revealed.map((_, i) =>
      window.setTimeout(() => soundPlayer.play('tunnelDraw'), i * REVEAL_STAGGER_MS),
    );
    return () => timers.forEach((id) => clearTimeout(id));
  }, [revealed, reduced]);

  // Result cue once the surcharge outcome is shown.
  useEffect(() => {
    if (showResult && !resultCuePlayed.current) {
      resultCuePlayed.current = true;
      soundPlayer.play(extraRequired === 0 ? 'tunnelSuccess' : 'tunnelPayment');
    }
  }, [showResult, extraRequired]);

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
        {showResult && spectator && (
          <div className="tunnel-result">
            <p className="tunnel-surcharge">
              {extraRequired === 0 ? t('tunnelNoExtra') : t('payExtra', { n: extraRequired })}
            </p>
            {extraRequired > 0 &&
              (() => {
                // The surcharge as a single colour-only combination: N cards of the played
                // colour (locomotives if the base claim played no colour). Read-only — it leaks
                // nothing about the claimant's hand, unlike the per-hand spend options.
                const surchargeColor = pbToCard(playedColor ?? 0) ?? 'LOCOMOTIVE';
                return (
                  <ul className="payment-options card-options">
                    <li>
                      <div
                        className="payment-card payment-card--readonly"
                        aria-label={`${CARD_COLOR_TOKENS[surchargeColor].nameZh} ×${extraRequired}`}
                      >
                        <TrainCarCard color={surchargeColor} count={extraRequired} size={CARD_SIZE} />
                      </div>
                    </li>
                  </ul>
                );
              })()}
          </div>
        )}
        {showResult && !spectator && (
          <div className="tunnel-result">
            {options.length === 0 ? (
              // Can't afford the surcharge — there's nothing to pay, so skip the payment screen
              // and just state it (centred). Abort is the only way on.
              <p className="tunnel-cannot">{t('cannotAfford')}</p>
            ) : (
              <>
                <p className="tunnel-surcharge">
                  {extraRequired === 0 ? t('tunnelNoExtra') : t('payExtra', { n: extraRequired })}
                </p>
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
                            <TrainCarCard
                              color="LOCOMOTIVE"
                              count={p.locomotives}
                              size={CARD_SIZE}
                            />
                          )}
                          {!hasCards && <span className="payment-confirm">{t('confirm')}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
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
