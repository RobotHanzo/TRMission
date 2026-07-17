import { useTranslation } from 'react-i18next';
import { useTurnCountdown } from '@trm/client-core/game/turnCountdown';

/**
 * The per-turn countdown ring (issue #13): shows how long the player on the clock has before the
 * server auto-plays for them. Renders nothing when nobody is on the clock (bot turn, game over,
 * replay/tutorial sandbox). The warning-tick and time's-up SOUNDS are not driven here: interval
 * ticking is throttled to a crawl in hidden tabs, so useSoundDriver pre-schedules them on the
 * audio clock instead (mobile still injects its callbacks into the shared hook).
 */
export function TurnCountdown() {
  const { t } = useTranslation();
  const cd = useTurnCountdown();
  if (!cd) return null;

  const frac = cd.totalMs > 0 ? Math.max(0, Math.min(1, cd.remainingMs / cd.totalMs)) : 0;
  const cls = 'turn-countdown' + (cd.warning ? ' is-warning' : '') + (cd.isSelf ? ' is-self' : '');

  return (
    <div
      className={cls}
      role="timer"
      aria-live={cd.warning && cd.isSelf ? 'assertive' : 'off'}
      aria-label={t('turnTimeRemaining', { seconds: cd.seconds })}
      title={cd.isSelf ? t('turnTimeoutHint') : undefined}
      style={{ ['--frac' as string]: frac }}
    >
      <span className="turn-countdown-secs">{cd.seconds}</span>
      <span className="turn-countdown-ring" aria-hidden />
    </div>
  );
}
