import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CardCounts } from '@trm/proto';
import { ticketById } from '../game/content';
import { TicketCard } from './TicketCard';
import { PlayerHand } from './PlayerHand';
import { TicketPanel } from './TicketPanel';

interface Props {
  offered: string[];
  minKeep: number;
  /** When true, long route tickets in the offer are locked and cannot be discarded. */
  lockLong?: boolean;
  /** The player's current train-card hand (peekable while choosing). */
  hand: CardCounts | undefined;
  handCount: number;
  /** The player's already-kept missions (peekable while choosing). */
  keptTicketIds: string[];
  completedIds?: ReadonlySet<string> | undefined;
  onConfirm(ids: string[]): void;
}

/**
 * The destination-ticket chooser, rendered as a sidebar panel (not a backdrop modal) so the
 * board stays visible and pan/zoomable underneath — players can preview the railways a ticket
 * would need before committing. Because the panel takes over the rail (hiding the usual hand and
 * missions trays), it carries collapsible peeks at the player's own hand and kept tickets.
 */
export function TicketChooser({
  offered,
  minKeep,
  lockLong,
  hand,
  handCount,
  keptTicketIds,
  completedIds,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const locked = lockLong
    ? new Set(offered.filter((id) => ticketById.get(id)?.deck === 'LONG'))
    : new Set<string>();
  const [kept, setKept] = useState<Set<string>>(() => new Set(offered)); // default: keep all
  const [showHand, setShowHand] = useState(false);
  const [showTickets, setShowTickets] = useState(false);

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
    <section className="ticket-chooser" aria-label={t('chooseTickets')}>
      <div className="tray-head">
        <h4>{t('chooseTickets')}</h4>
        <span className="tray-count">{kept.size}</span>
      </div>
      <p className="muted chooser-hint">
        {t('keepAtLeast', { n: minKeep })} · {t('ticketPreviewHint')}
      </p>

      <div className="chooser-offer">
        {offered.map((id, i) => (
          // `--i` staggers the draw-in flip so the offered tickets deal out one after another.
          <div key={id} className="ticket-slot ticket-deal-in" style={{ '--i': i } as CSSProperties}>
            <TicketCard
              ticketId={id}
              selected={kept.has(id)}
              onToggle={toggle}
              disabled={locked.has(id)}
            />
          </div>
        ))}
      </div>

      <button
        className="primary chooser-confirm"
        disabled={kept.size < minKeep}
        onClick={() => onConfirm([...kept])}
      >
        {t('keep')} ({kept.size})
      </button>

      {/* Peek at the player's own cards/tickets — hidden because the chooser replaced the rail. */}
      <div className="chooser-peeks">
        <button
          type="button"
          className="peek-toggle"
          aria-expanded={showHand}
          onClick={() => setShowHand((v) => !v)}
        >
          {showHand ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span className="peek-label">{t('cards')}</span>
          <span className="tray-count">{handCount}</span>
        </button>
        {showHand && (
          <div className="peek-body">
            <PlayerHand hand={hand} />
          </div>
        )}

        <button
          type="button"
          className="peek-toggle"
          aria-expanded={showTickets}
          onClick={() => setShowTickets((v) => !v)}
        >
          {showTickets ? (
            <ChevronDown size={15} aria-hidden />
          ) : (
            <ChevronRight size={15} aria-hidden />
          )}
          <span className="peek-label">{t('tickets')}</span>
          <span className="tray-count">{keptTicketIds.length}</span>
        </button>
        {showTickets && (
          <div className="peek-body">
            <TicketPanel ticketIds={keptTicketIds} completedIds={completedIds} />
          </div>
        )}
      </div>
    </section>
  );
}
