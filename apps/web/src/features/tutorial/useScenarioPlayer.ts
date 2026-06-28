// Drives one lesson: builds a SandboxSocket over a local engine game, fast-forwards the optional
// silent setup, then walks the beats — running `auto` actions on a timer, and advancing `await`
// beats when the learner performs the matching move (detected via the sandbox's onAction hook). It
// projects into the passed game store, so the existing board + HUD render the scenario unchanged.
import { useCallback, useEffect, useRef, useState } from 'react';
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { Board, GameConfig } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { SandboxSocket } from '../../net/sandboxSocket';
import type { useGame } from '../../store/game';
import { expectMatches, type Beat, type Lesson } from './types';

type GameStore = typeof useGame;

export interface ScenarioPlayer {
  beat: Beat | null;
  index: number;
  total: number;
  done: boolean;
  commands: SandboxSocket | null;
  /** Advance the current `info` beat (the coachmark "Next" button). */
  next(): void;
  /** Rebuild the lesson from the start. */
  restart(): void;
}

export function useScenarioPlayer(lesson: Lesson, store: GameStore): ScenarioPlayer {
  const [index, setIndex] = useState(0);
  const [, setBuilt] = useState(0);
  const idxRef = useRef(0);
  idxRef.current = index;
  const sandboxRef = useRef<SandboxSocket | null>(null);
  const boardRef = useRef<Board | null>(null);
  const [nonce, setNonce] = useState(0);

  // Build (or rebuild) the sandbox for this lesson.
  useEffect(() => {
    const board = taiwanBoard();
    boardRef.current = board;
    const viewer = asPlayerId(lesson.viewer);
    const config: GameConfig = {
      seed: lesson.seed,
      players: lesson.players,
      contentHash: CONTENT_HASH,
      ...(lesson.ruleParams ? { ruleParams: lesson.ruleParams } : {}),
    };
    store.getState().reset();
    const sandbox = new SandboxSocket(board, config, viewer, {
      applySnapshot: (s) => store.getState().applySnapshot(s),
      applyEvents: (v, e) => store.getState().applyEvents(v, e),
      setRejection: (r) => store.getState().setRejection(r),
      onAction: (action) => {
        const b = lesson.beats[idxRef.current];
        if (
          b &&
          b.mode === 'await' &&
          (action.player as string) === (viewer as string) &&
          expectMatches(b.expect, action)
        ) {
          setIndex((i) => i + 1);
        }
      },
    });
    if (lesson.setup) for (const a of lesson.setup(sandbox.getState(), board)) sandbox.auto(a);
    sandboxRef.current = sandbox;
    setIndex(0);
    setBuilt((n) => n + 1);
    return () => {
      sandboxRef.current = null;
      store.getState().reset();
    };
  }, [lesson, store, nonce]);

  // Run an `auto` beat: fire its scripted action then advance.
  useEffect(() => {
    const sandbox = sandboxRef.current;
    const board = boardRef.current;
    const b = lesson.beats[index];
    if (!sandbox || !board || !b || b.mode !== 'auto') return;
    const id = setTimeout(() => {
      const action =
        typeof b.action === 'function' ? b.action(sandbox.getState(), board) : b.action;
      sandbox.auto(action);
      setIndex((i) => (i === index ? i + 1 : i));
    }, b.delayMs ?? 900);
    return () => clearTimeout(id);
  }, [index, lesson.beats]);

  const next = useCallback(() => {
    const b = lesson.beats[idxRef.current];
    if (b && b.mode === 'info') setIndex((i) => i + 1);
  }, [lesson.beats]);

  const restart = useCallback(() => setNonce((n) => n + 1), []);

  return {
    beat: lesson.beats[index] ?? null,
    index,
    total: lesson.beats.length,
    done: index >= lesson.beats.length,
    commands: sandboxRef.current,
    next,
    restart,
  };
}
