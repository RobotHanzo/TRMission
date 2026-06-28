import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAnimationsStore, type Flight, type Float, type TicketCue } from '../store/animations';
import { useGameStore } from '../store/game';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { SEAT_COLORS } from '../theme/colors';
import { FlyingCard } from './FlyingCard';
import { TicketCard } from './TicketCard';
import { TicketFanfare } from './TicketFanfare';
import { EndgameWarning } from './EndgameWarning';

const rectOf = (selector: string): DOMRect | null =>
  document.querySelector(selector)?.getBoundingClientRect() ?? null;
const seatColor = (seat: number): string => SEAT_COLORS[seat % 5] ?? '#888';

// Cards travel at hand-card size (not the tiny deck/slot footprint), so the draw reads clearly.
const CARD_W = 120;
const CARD_H = Math.round((CARD_W * 92) / 132);

/** One in-flight card, animated from its source (deck/market slot) to its target (hand/tracker). */
function FlightMover({ flight }: { flight: Flight }) {
  const removeFlight = useAnimationsStore((s) => s.removeFlight);
  const me = useGameStore((s) => s.snapshot?.you?.playerId ?? null);
  const reduced = useReducedMotion();
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  const done = useRef(false);

  useLayoutEffect(() => {
    const finish = (): void => {
      if (done.current) return;
      done.current = true;
      removeFlight(flight.id);
    };
    const src =
      flight.slot !== null
        ? rectOf(`[data-anim="market-slot"][data-slot="${flight.slot}"]`)
        : rectOf('[data-anim="deck"]');
    const dst =
      flight.toPlayerId === me
        ? rectOf('[data-anim="hand"]')
        : rectOf(`[data-player-id="${flight.toPlayerId}"]`);
    if (!src || !dst || reduced) {
      finish();
      return;
    }
    const srcCx = src.left + src.width / 2;
    const srcCy = src.top + src.height / 2;
    // Fixed card size centred on the source; the card appears to grow out of the deck/slot.
    const base: CSSProperties = {
      left: srcCx - CARD_W / 2,
      top: srcCy - CARD_H / 2,
      width: CARD_W,
      height: CARD_H,
      opacity: 1,
      transform: 'translate(0,0) scale(0.8)',
    };
    setStyle(base);
    const dx = dst.left + dst.width / 2 - srcCx;
    const dy = dst.top + dst.height / 2 - srcCy;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setStyle({
          ...base,
          transition: 'transform 0.6s cubic-bezier(0.4,0,0.2,1), opacity 0.6s ease',
          transform: `translate(${dx}px, ${dy}px) scale(1)`,
          opacity: 0.1,
        }),
      ),
    );
    const fallback = window.setTimeout(finish, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
  }, [flight, me, reduced, removeFlight]);

  return (
    <div
      className={'flying-card' + (flight.color ? ' is-face' : ' is-cover')}
      style={style}
      onTransitionEnd={() => removeFlight(flight.id)}
    >
      <FlyingCard color={flight.color} width={CARD_W} />
    </div>
  );
}

/** A floating "+N" rising from a player's tracker when they score. */
function FloatMover({ float }: { float: Float }) {
  const removeFloat = useAnimationsStore((s) => s.removeFloat);
  const seat = useGameStore(
    (s) => s.snapshot?.players.find((p) => p.id === float.playerId)?.seat ?? 0,
  );
  const [style, setStyle] = useState<CSSProperties>({ display: 'none' });

  useLayoutEffect(() => {
    const r = rectOf(`[data-player-id="${float.playerId}"]`);
    if (!r) {
      removeFloat(float.id);
      return;
    }
    setStyle({ left: r.right - 30, top: r.top + 2, '--seat': seatColor(seat) } as CSSProperties);
    const fallback = window.setTimeout(() => removeFloat(float.id), 1300);
    return () => clearTimeout(fallback);
  }, [float, seat, removeFloat]);

  return (
    <div className="score-float" style={style} onAnimationEnd={() => removeFloat(float.id)}>
      +{float.amount}
    </div>
  );
}

/** An opponent's completion: a small revealed ticket card near their tracker (no screen takeover). */
function TicketCueView({ cue }: { cue: TicketCue }) {
  const { t } = useTranslation();
  const removeTicketCue = useAnimationsStore((s) => s.removeTicketCue);
  const [style, setStyle] = useState<CSSProperties>({ display: 'none' });

  useLayoutEffect(() => {
    const r = rectOf(`[data-player-id="${cue.playerId}"]`);
    if (!r) {
      removeTicketCue(cue.id);
      return;
    }
    setStyle({
      left: Math.min(r.left, window.innerWidth - 180),
      top: r.bottom + 6,
      '--seat': seatColor(cue.seat),
    } as CSSProperties);
    const fallback = window.setTimeout(() => removeTicketCue(cue.id), 2800);
    return () => clearTimeout(fallback);
  }, [cue, removeTicketCue]);

  return (
    <div className="ticket-cue" style={style} onAnimationEnd={() => removeTicketCue(cue.id)}>
      <span className="ticket-cue-label">{t('completedTicket')}</span>
      <div style={{ width: 150 }}>
        <TicketCard ticketId={cue.ticketId} />
      </div>
    </div>
  );
}

/** Fixed full-viewport overlay: travelling cards, score floats, opponent cues, and the fanfare. */
export function AnimationLayer() {
  const flights = useAnimationsStore((s) => s.flights);
  const floats = useAnimationsStore((s) => s.floats);
  const ticketCues = useAnimationsStore((s) => s.ticketCues);
  const fanfare = useAnimationsStore((s) => s.fanfare);
  const dismissFanfare = useAnimationsStore((s) => s.dismissFanfare);
  const endgameCue = useAnimationsStore((s) => s.endgameCue);
  const dismissEndgameWarning = useAnimationsStore((s) => s.dismissEndgameWarning);
  const reduced = useReducedMotion();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {flights.map((f) => (
        <FlightMover key={f.id} flight={f} />
      ))}
      {floats.map((f) => (
        <FloatMover key={f.id} float={f} />
      ))}
      {ticketCues.map((c) => (
        <TicketCueView key={c.id} cue={c} />
      ))}
      {fanfare && (
        <TicketFanfare
          key={fanfare.id}
          fanfare={fanfare}
          reducedMotion={reduced}
          onDone={dismissFanfare}
        />
      )}
      {endgameCue && (
        <EndgameWarning
          key={endgameCue.id}
          cue={endgameCue}
          reducedMotion={reduced}
          onDone={dismissEndgameWarning}
        />
      )}
    </>,
    document.body,
  );
}
