import { useTranslation } from 'react-i18next';
import { ticketLabel } from '../game/content';
import { useUi } from '../store/ui';

export function TicketPanel({ ticketIds }: { ticketIds: string[] }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  return (
    <div className="ticket-panel">
      <h4>{t('tickets')}</h4>
      {ticketIds.length === 0 ? (
        <span className="muted">—</span>
      ) : (
        <ul>
          {ticketIds.map((id) => {
            const l = ticketLabel(id, locale);
            return l ? (
              <li key={id} className={l.long ? 'ticket long' : 'ticket'}>
                <span>
                  {l.a} – {l.b}
                </span>
                <b>{l.value}</b>
              </li>
            ) : null;
          })}
        </ul>
      )}
    </div>
  );
}
