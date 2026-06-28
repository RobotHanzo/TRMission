import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useAnimations, type Flight } from '../store/animations';
import { useGame } from '../store/game';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { FlyingCard } from './FlyingCard';

const rectOf = (selector: string): DOMRect | null =>
  document.querySelector(selector)?.getBoundingClientRect() ?? null;

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

/** Fixed full-viewport overlay for travelling cards (floats, cues, fanfare are added later). */
export function AnimationLayer() {
  const flights = useAnimations((s) => s.flights);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {flights.map((f) => (
        <FlightMover key={f.id} flight={f} />
      ))}
    </>,
    document.body,
  );
}
