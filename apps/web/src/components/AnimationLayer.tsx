import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useAnimations, type Flight, type Float } from '../store/animations';
import { useGame } from '../store/game';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { SEAT_COLORS } from '../theme/colors';
import { FlyingCard } from './FlyingCard';

const rectOf = (selector: string): DOMRect | null =>
  document.querySelector(selector)?.getBoundingClientRect() ?? null;
const seatColor = (seat: number): string => SEAT_COLORS[seat % 5] ?? '#888';

/** One in-flight card, animated from its source (deck/market slot) to its target (hand/tracker). */
function FlightMover({ flight }: { flight: Flight }) {
  const removeFlight = useAnimations((s) => s.removeFlight);
  const me = useGame((s) => s.snapshot?.you?.playerId ?? null);
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
    const base: CSSProperties = {
      left: src.left,
      top: src.top,
      width: src.width,
      height: src.height,
      opacity: 1,
      transform: 'translate(0,0) scale(1)',
    };
    setStyle(base);
    const dx = dst.left + dst.width / 2 - (src.left + src.width / 2);
    const dy = dst.top + dst.height / 2 - (src.top + src.height / 2);
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setStyle({
          ...base,
          transition: 'transform 0.55s cubic-bezier(0.4,0,0.2,1), opacity 0.55s ease',
          transform: `translate(${dx}px, ${dy}px) scale(0.45)`,
          opacity: 0.15,
        }),
      ),
    );
    const fallback = window.setTimeout(finish, 900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
  }, [flight, me, reduced, removeFlight]);

  return (
    <div
      className={'flying-card' + (flight.color ? '' : ' is-cover')}
      style={style}
      onTransitionEnd={() => removeFlight(flight.id)}
    >
      <FlyingCard color={flight.color} />
    </div>
  );
}

/** A floating "+N" rising from a player's tracker when they score. */
function FloatMover({ float }: { float: Float }) {
  const removeFloat = useAnimations((s) => s.removeFloat);
  const seat = useGame((s) => s.snapshot?.players.find((p) => p.id === float.playerId)?.seat ?? 0);
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

/** Fixed full-viewport overlay for travelling cards, score floats (cues/fanfare added later). */
export function AnimationLayer() {
  const flights = useAnimations((s) => s.flights);
  const floats = useAnimations((s) => s.floats);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {flights.map((f) => (
        <FlightMover key={f.id} flight={f} />
      ))}
      {floats.map((f) => (
        <FloatMover key={f.id} float={f} />
      ))}
    </>,
    document.body,
  );
}
