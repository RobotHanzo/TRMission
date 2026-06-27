import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketById } from '../game/content';
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

  const toggle = (id: string) => {
    if (locked.has(id)) return;
    setKept((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal modal-tickets" role="dialog" aria-modal="true">
        <h3>{t('chooseTickets')}</h3>
        <p className="muted">{t('keepAtLeast', { n: minKeep })}</p>
        <div className="ticket-cards">
          {offered.map((id) => (
            <TicketCard
              key={id}
              ticketId={id}
              selected={kept.has(id)}
              onToggle={toggle}
              disabled={locked.has(id)}
            />
          ))}
        </div>
        <button
          className="primary"
          disabled={kept.size < minKeep}
          onClick={() => onConfirm([...kept])}
        >
          {t('keep')} ({kept.size})
        </button>
      </div>
    </div>
  );
}
