import confetti from 'canvas-confetti';
import { useEffect } from 'react';
import { useReducedMotion } from './useReducedMotion';

const COLORS = ['#e8732c', '#0f4c81', '#ffd76a', '#4caf50', '#9c27b0', '#e91e63'];
const INTERVAL_MS = 1800;

/** Fires continuous confetti bursts from both sides while `active` is true. No-op under reduced motion. */
export function useConfetti(active: boolean): void {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!active || reduced) return;

    const fire = (): void => {
      confetti({
        particleCount: 45,
        angle: 60,
        spread: 58,
        origin: { x: 0, y: 0.65 },
        colors: COLORS,
      });
      confetti({
        particleCount: 45,
        angle: 120,
        spread: 58,
        origin: { x: 1, y: 0.65 },
        colors: COLORS,
      });
    };

    fire();
    const id = setInterval(fire, INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, reduced]);
}
