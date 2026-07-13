import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CardCounts } from '@trm/proto';
import { ticketById } from '../game/content';
import { TICKET_DEAL_STAGGER_MS } from '../game/tickets';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { soundPlayer } from '../sound/player';
import { TicketCard } from './TicketCard';
import { PlayerHand } from './PlayerHand';
import { TicketPanel } from './TicketPanel';

// Deal-in tick cadence, kept in step with `.ticket-deal-in` in animations.css (0.12s stagger).
const DEAL_STAGGER_MS = TICKET_DEAL_STAGGER_MS;

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
  /** Tutorial gate: when true, the offer is previewable but committing is disabled until a beat
   *  explicitly asks the learner to keep (so they can't draft ahead of the prompt). */
  confirmDisabled?: boolean | undefined;
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
  confirmDisabled,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const locked = lockLong
    ? new Set(offered.filter((id) => ticketById.get(id)?.deck === 'LONG'))
    : new Set<string>();
  const [kept, setKept] = useState<Set<string>>(() => new Set(offered)); // default: keep all
  const [showHand, setShowHand] = useState(false);
  const [showTickets, setShowTickets] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [flyStyles, setFlyStyles] = useState<Map<string, CSSProperties>>(new Map());
  const slotRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const reduced = useReducedMotion();

  // A deal-out tick per offered ticket, synced to the deal-in flip — the same cue as a tunnel
  // reveal. Keyed by the offer *contents* (not the array identity): during simultaneous setup
  // selection opponents' moves push frequent new snapshots that re-create `offered` with the same
  // ids, and re-running on those would clear the in-flight stagger timers (silencing all but the
  // first tick). One immediate tick under reduced motion (the cards appear at once).
  const offerKey = offered.join('|');
  useEffect(() => {
    if (offerKey === '') return;
    if (reduced) {
      soundPlayer.play('tunnelDraw');
      return;
    }
    const count = offerKey.split('|').length;
    const timers = Array.from({ length: count }, (_, i) =>
      window.setTimeout(() => soundPlayer.play('tunnelDraw'), i * DEAL_STAGGER_MS),
    );
    return () => timers.forEach((id) => clearTimeout(id));
  }, [offerKey, reduced]);

  const toggle = (id: string) => {
    if (locked.has(id) || confirming) return;
    setKept((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // On Keep, kept tickets fly into the missions peek toggle and discards drop away, then we commit
  // (instant under reduced motion). Targets are measured live so the flight lands where they are.
  const confirm = () => {
    if (confirming || confirmDisabled) return;
    const ids = [...kept];
    if (reduced) {
      onConfirm(ids);
      return;
    }
    const target =
      document.querySelector('[data-anim="kept-target"]')?.getBoundingClientRect() ?? null;
    const styles = new Map<string, CSSProperties>();
    for (const id of offered) {
      const r = slotRefs.current.get(id)?.getBoundingClientRect();
      if (!r) continue;
      if (kept.has(id) && target) {
        const dx = target.left + target.width / 2 - (r.left + r.width / 2);
        const dy = target.top + target.height / 2 - (r.top + r.height / 2);
        styles.set(id, { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0 });
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
    <section className="ticket-chooser" aria-label={t('chooseTickets')}>
      <div className="tray-head">
        <h4>{t('chooseTickets')}</h4>
        <span className="tray-count">{kept.size}</span>
      </div>
      <p className="muted chooser-hint">
        {t('keepAtLeast', { n: minKeep })} · {t('ticketPreviewHint')}
      </p>

      <div className={confirming ? 'chooser-offer is-confirming' : 'chooser-offer'}>
        {offered.map((id, i) => (
          // `--i` staggers the draw-in flip; on confirm the slot carries its live flight transform.
          <div
            key={id}
            className="ticket-slot ticket-deal-in"
            ref={(el) => {
              if (el) slotRefs.current.set(id, el);
              else slotRefs.current.delete(id);
            }}
            style={{ '--i': i, ...(confirming ? flyStyles.get(id) : null) } as CSSProperties}
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

      <button
        className="primary chooser-confirm"
        disabled={kept.size < minKeep || confirming || confirmDisabled}
        onClick={confirm}
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
          {showHand ? (
            <ChevronDown size={15} aria-hidden />
          ) : (
            <ChevronRight size={15} aria-hidden />
          )}
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
          data-anim="kept-target"
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
