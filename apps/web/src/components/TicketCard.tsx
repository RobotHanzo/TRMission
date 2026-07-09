import { useTranslation } from 'react-i18next';
import { ticketById, ticketLabel, CITIES, ROUTES, cityById } from '../game/content';
import { ACTIVE_GEOGRAPHY, ACTIVE_BASE_VIEW } from '../game/catalog';
import { useUi } from '../store/ui';
import { RoutePreview } from './RoutePreview';

interface Props {
  ticketId: string;
  /** When provided the card becomes a toggle (used while choosing tickets). */
  selected?: boolean;
  onToggle?: (id: string) => void;
  /** Prevents toggling (for mandatory long tickets during initial selection). */
  disabled?: boolean;
  /** Greys the card out and stamps a completion checkmark (finished mission). */
  completed?: boolean;
}

/**
 * A mission (destination ticket) card: a mini-map preview of the two endpoint
 * cities over the Taiwan board, a perforated ticket stub with the city pair, and
 * the point value. Long routes wear an EMU-blue livery, short routes a warm one.
 */
export function TicketCard({ ticketId, selected, onToggle, disabled, completed }: Props) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const def = ticketById.get(ticketId);
  const label = ticketLabel(ticketId, locale);
  if (!def || !label) return null;

  const tone = label.long ? 'long' : 'short';
  const selectable = onToggle !== undefined;
  const aria = `${label.a} – ${label.b}, ${label.value} ${t('points')}${
    completed ? `, ${t('completed')}` : ''
  }`;
  const a = cityById.get(def.a as string);
  const b = cityById.get(def.b as string);

  const body = (
    <>
      <div className="ticket-map">
        {a && b && (
          <RoutePreview
            a={a}
            b={b}
            cities={CITIES}
            routes={ROUTES}
            geography={ACTIVE_GEOGRAPHY}
            baseView={ACTIVE_BASE_VIEW}
            view={def.view}
            tone={tone}
          />
        )}
        {label.long && <span className="ticket-flag">{t('longRoute')}</span>}
        {selectable && <span className="ticket-check" aria-hidden />}
      </div>
      <div className="ticket-foot">
        <span className="ticket-route">
          <b>{label.a}</b>
          <span className="ticket-dash" aria-hidden />
          <b>{label.b}</b>
        </span>
        <span className="ticket-value">{label.value}</span>
      </div>
      {completed && <span className="ticket-done" aria-hidden />}
    </>
  );

  if (selectable) {
    return (
      <button
        type="button"
        className={`ticket-card tone-${tone}${selected ? ' is-selected' : ''}${disabled ? ' is-locked' : ''}`}
        aria-pressed={selected}
        aria-label={aria}
        disabled={disabled}
        onClick={() => onToggle(ticketId)}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={`ticket-card tone-${tone}${completed ? ' is-completed' : ''}`}
      role="img"
      aria-label={aria}
    >
      {body}
    </div>
  );
}
