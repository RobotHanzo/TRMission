import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import confetti from 'canvas-confetti';
import { ticketById } from '../game/content';
import { SEAT_COLORS } from '../theme/colors';
import type { Fanfare } from '../store/animations';
import { TicketCard } from './TicketCard';

const seatColor = (seat: number): string => SEAT_COLORS[seat % 5] ?? '#888';

interface Props {
  fanfare: Fanfare;
  reducedMotion: boolean;
  onDone(): void;
}

/**
 * Full-screen celebration for the local player's own ticket completion (item 4). Confetti (more for
 * a long-haul), the enlarged ticket card, and instant points. Skippable: click / Escape / auto, and
 * always under the 7s cap. Reduced motion → a static banner with no confetti.
 */
export function TicketFanfare({ fanfare, reducedMotion, onDone }: Props) {
  const { t } = useTranslation();
  const def = ticketById.get(fanfare.ticketId);
  const value = def?.value ?? 0;
  const color = seatColor(fanfare.seat);

  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);

    const ttl = reducedMotion ? 1500 : fanfare.long ? 6500 : 4000; // hard cap < 7000ms
    const timer = window.setTimeout(finish, ttl);

    const confettiTimers: number[] = [];
    if (!reducedMotion) {
      const fire = (opts?: Parameters<typeof confetti>[0]): void => {
        confetti({ particleCount: 90, spread: 75, origin: { y: 0.6 }, colors: [color, '#ffffff'], ...opts });
      };
      fire();
      if (fanfare.long) {
        confettiTimers.push(
          window.setTimeout(() => fire({ particleCount: 130, angle: 60, spread: 100, origin: { x: 0, y: 0.7 } }), 250),
          window.setTimeout(() => fire({ particleCount: 130, angle: 120, spread: 100, origin: { x: 1, y: 0.7 } }), 450),
          window.setTimeout(() => fire({ particleCount: 90 }), 950),
        );
      }
    }

    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
      confettiTimers.forEach(clearTimeout);
    };
  }, [fanfare, reducedMotion, color, finish]);

  return (
    <div className="fanfare-backdrop" style={{ '--seat': color } as CSSProperties} onClick={finish}>
      <div className="fanfare-panel">
        <div className="fanfare-title">{t('fanfareTitle')}</div>
        {fanfare.long && <div className="fanfare-sub">{t('fanfareLong')}</div>}
        <div className="fanfare-card-wrap">
          <TicketCard ticketId={fanfare.ticketId} />
        </div>
        <div className="fanfare-value">
          +{value} {t('points')}
        </div>
        <div className="fanfare-skip">{t('skip')}</div>
      </div>
    </div>
  );
}
