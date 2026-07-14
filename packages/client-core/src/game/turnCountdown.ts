import { useEffect, useRef, useState } from 'react';
import { Phase } from '@trm/proto';
import { useGameStore } from '../store/game';

/** Final stretch of a turn: urgency styling plus one warning tick per remaining second. */
export const COUNTDOWN_WARN_MS = 10_000;
/** How often the displayed value refreshes (ms) — smooth enough for a bar, cheap to re-render. */
const REFRESH_MS = 200;

export interface TurnCountdownView {
  remainingMs: number;
  totalMs: number;
  /** Whole seconds remaining, for the numeric display. */
  seconds: number;
  /** The local viewer is the one on the clock (drives sounds + "self" styling). */
  isSelf: boolean;
  /** In the final-stretch warning window. */
  warning: boolean;
}

/**
 * Platform sound side-effects, injected so this hook stays render-neutral (no DOM/expo audio import
 * leaks into `@trm/client-core`). Only ever called for the LOCAL player being timed.
 */
export interface TurnCountdownSounds {
  /** Fire once per remaining whole second inside the warning window. */
  onWarningTick?(): void;
  /** Fire once the instant the countdown reaches zero. */
  onLapsed?(): void;
}

/**
 * The live per-turn countdown (issue #13), shared by web and mobile. Reads the server-pushed
 * deadline from the game store and ticks it down locally; when the LOCAL player is on the clock it
 * fires the injected warning-tick cue each remaining second and the time's-up cue once it lapses.
 * Returns null when nobody is on the clock — a bot's turn, game over, a sandbox/replay (which never
 * receives a timer), or the timer being disabled server-side.
 */
export function useTurnCountdown(sounds?: TurnCountdownSounds): TurnCountdownView | null {
  const timer = useGameStore((s) => s.turnTimer);
  const me = useGameStore((s) => s.snapshot?.you?.playerId ?? null);
  const gameOver = useGameStore((s) => s.snapshot?.phase === Phase.GAME_OVER);
  const [remainingMs, setRemainingMs] = useState(() =>
    timer ? Math.max(0, timer.deadline - Date.now()) : 0,
  );

  // Latest callbacks kept in a ref so the ticking effect doesn't restart when they change identity.
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  // One-shot sound guards, reset whenever the timer (a new turn) changes.
  const lastTickSecond = useRef<number | null>(null);
  const lapsedFired = useRef(false);

  useEffect(() => {
    lastTickSecond.current = null;
    lapsedFired.current = false;
    if (!timer) {
      setRemainingMs(0);
      return;
    }
    const isSelf = me !== null && timer.playerId === me;
    const step = (): void => {
      const rem = Math.max(0, timer.deadline - Date.now());
      setRemainingMs(rem);
      if (!isSelf) return;
      if (rem > 0 && rem <= COUNTDOWN_WARN_MS) {
        const sec = Math.ceil(rem / 1000);
        if (lastTickSecond.current !== sec) {
          lastTickSecond.current = sec;
          soundsRef.current?.onWarningTick?.();
        }
      } else if (rem <= 0 && !lapsedFired.current) {
        lapsedFired.current = true;
        soundsRef.current?.onLapsed?.();
      }
    };
    step();
    const id = setInterval(step, REFRESH_MS);
    return () => clearInterval(id);
  }, [timer, me]);

  if (!timer || gameOver) return null;
  const isSelf = me !== null && timer.playerId === me;
  return {
    remainingMs,
    totalMs: timer.totalMs,
    seconds: Math.ceil(remainingMs / 1000),
    isSelf,
    warning: remainingMs <= COUNTDOWN_WARN_MS,
  };
}
