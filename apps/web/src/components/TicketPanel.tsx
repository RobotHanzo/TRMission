import { useTranslation } from 'react-i18next';
import { TicketCard } from './TicketCard';
import { SECRET_CLASS } from '../observability/secrets';

interface Props {
  ticketIds: string[];
  /** Ids of completed missions — greyed out, checkmarked, and sunk to the bottom. */
  completedIds?: ReadonlySet<string> | undefined;
}

/** The player's kept mission cards, each with a route-preview mini-map. */
export function TicketPanel({ ticketIds, completedIds }: Props) {
  const { t } = useTranslation();
  if (ticketIds.length === 0) return <span className="muted">{t('noTickets')}</span>;

  // Completed missions sink to the bottom of the deck; otherwise keep server order.
  const isDone = (id: string): boolean => completedIds?.has(id) ?? false;
  const ordered = [...ticketIds].sort((a, b) => Number(isDone(a)) - Number(isDone(b)));

  return (
    // SECRET_CLASS: kept missions stay secret until scoring — Session Replay must not record them.
    <div className={`ticket-cards ${SECRET_CLASS}`}>
      {ordered.map((id) => (
        <TicketCard key={id} ticketId={id} completed={isDone(id)} />
      ))}
    </div>
  );
}
