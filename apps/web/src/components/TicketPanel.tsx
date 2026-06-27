import { useTranslation } from 'react-i18next';
import { TicketCard } from './TicketCard';

/** The player's kept mission cards, each with a route-preview mini-map. */
export function TicketPanel({ ticketIds }: { ticketIds: string[] }) {
  const { t } = useTranslation();
  return ticketIds.length === 0 ? (
    <span className="muted">{t('noTickets')}</span>
  ) : (
    <div className="ticket-cards">
      {ticketIds.map((id) => (
        <TicketCard key={id} ticketId={id} />
      ))}
    </div>
  );
}
