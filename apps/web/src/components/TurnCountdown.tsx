import { useTranslation } from 'react-i18next';
import { useTurnCountdown } from '@trm/client-core/game/turnCountdown';
import { soundPlayer } from '../sound/player';

// Module-level (stable identity) so the hook's ticking effect never restarts on re-render.
const SOUNDS = {
  onWarningTick: () => soundPlayer.play('countdownWarning'),
  onLapsed: () => soundPlayer.play('countdownLapsed'),
};

/**
 * The per-turn countdown ring (issue #13): shows how long the player on the clock has before the
 * server auto-plays for them. Renders nothing when nobody is on the clock (bot turn, game over,
 * replay/tutorial sandbox). The warning-tick and time's-up sounds fire for the local player only,
 * driven inside the shared {@link useTurnCountdown} hook.
 */
export function TurnCountdown() {
  const { t } = useTranslation();
  const cd = useTurnCountdown(SOUNDS);
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
