import { useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketById } from '../game/content';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { TicketCard } from './TicketCard';

interface Props {
  offered: string[];
  minKeep: number;
  /** When true, long route tickets in the offer are locked and cannot be discarded. */
  lockLong?: boolean;
  onConfirm(ids: string[]): void;
}

export function KeepTicketsModal({ offered, minKeep, lockLong, onConfirm }: Props) {
  const { t } = useTranslation();
  const locked = lockLong
    ? new Set(offered.filter((id) => ticketById.get(id)?.deck === 'LONG'))
    : new Set<string>();
  const [kept, setKept] = useState<Set<string>>(() => new Set(offered)); // default: keep all
  const [confirming, setConfirming] = useState(false);
  const [flyStyles, setFlyStyles] = useState<Map<string, CSSProperties>>(new Map());
  const slotRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const reduced = useReducedMotion();

  const toggle = (id: string) => {
    if (locked.has(id) || confirming) return;
    setKept((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // Kept tickets fly into the missions tray; discarded ones drop away. Then commit (instant under
  // reduced motion). Targets are measured live so the flight lands wherever the tray actually is.
  const confirm = () => {
    if (confirming) return;
    const ids = [...kept];
    if (reduced) {
      onConfirm(ids);
      return;
    }
    const tray = document.querySelector('[data-anim="tickets"]')?.getBoundingClientRect() ?? null;
    const styles = new Map<string, CSSProperties>();
    for (const id of offered) {
      const r = slotRefs.current.get(id)?.getBoundingClientRect();
      if (!r) continue;
      if (kept.has(id) && tray) {
        const dx = tray.left + tray.width / 2 - (r.left + r.width / 2);
        const dy = tray.top + tray.height / 2 - (r.top + r.height / 2);
        styles.set(id, { transform: `translate(${dx}px, ${dy}px) scale(0.32)`, opacity: 0 });
      } else {
        const dy = window.innerHeight - r.top + 60;
        styles.set(id, { transform: `translate(0, ${dy}px) rotate(7deg) scale(0.85)`, opacity: 0 });
      }
    }
    setConfirming(true);
    // Two frames so the slots paint at rest first, then transition to their targets.
    requestAnimationFrame(() => requestAnimationFrame(() => setFlyStyles(styles)));
    window.setTimeout(() => onConfirm(ids), 540);
  };

  return (
    <div className={confirming ? 'modal-backdrop is-flying' : 'modal-backdrop'}>
      <div
        className={confirming ? 'modal modal-tickets is-flying' : 'modal modal-tickets'}
        role="dialog"
        aria-modal="true"
      >
        <h3>{t('chooseTickets')}</h3>
        <p className="muted">{t('keepAtLeast', { n: minKeep })}</p>
        <div className={confirming ? 'ticket-cards is-confirming' : 'ticket-cards'}>
          {offered.map((id) => (
            <div
              key={id}
              className="ticket-slot"
              ref={(el) => {
                if (el) slotRefs.current.set(id, el);
                else slotRefs.current.delete(id);
              }}
              style={confirming ? flyStyles.get(id) : undefined}
            >
              <TicketCard
                ticketId={id}
                selected={kept.has(id)}
                onToggle={toggle}
                disabled={locked.has(id)}
              />
            </div>
          ))}
        </div>
        <button className="primary" disabled={kept.size < minKeep || confirming} onClick={confirm}>
          {t('keep')} ({kept.size})
        </button>
      </div>
    </div>
  );
}
