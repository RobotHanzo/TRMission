// Drives one lesson: builds a SandboxSocket over a local engine game, fast-forwards the optional
// silent setup, then walks the beats — running `auto` actions on a timer, and advancing `await`
// beats when the learner performs the matching move (detected via the sandbox's onAction hook). It
// projects into the passed game store, so the existing board + HUD render the scenario unchanged.
import { useCallback, useEffect, useRef, useState } from 'react';
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { Board, GameConfig } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { SandboxSocket } from '../net/sandboxSocket';
import type { useGame } from '../store/game';
import { expectMatches, type Beat, type Lesson } from './types';

type GameStore = typeof useGame;

/** Perform an `await` beat's expected move during a manual seek (the encyclopedia has no learner). */
export type PerformAwait = (cmd: SandboxSocket, beat: Beat) => void;

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
  /** Jump to beat `target`, rebuilding the sandbox and replaying every earlier beat so the board
   *  state matches. `performAwait` satisfies any `await` beats encountered during the replay. */
  seek(target: number, performAwait?: PerformAwait): void;
}

/**
 * @param autoplay When false, `auto` beats no longer self-advance on their timer — used by the
 *   encyclopedia so a paused demo (and manual stepping) holds its frame instead of rolling on.
 */
export function useScenarioPlayer(
  lesson: Lesson,
  store: GameStore,
  autoplay = true,
): ScenarioPlayer {
  const [index, setIndex] = useState(0);
  const [, setBuilt] = useState(0);
  const idxRef = useRef(0);
  idxRef.current = index;
  const sandboxRef = useRef<SandboxSocket | null>(null);
  const boardRef = useRef<Board | null>(null);
  const [nonce, setNonce] = useState(0);
  // While true, the sandbox's onAction hook does NOT auto-advance — so a seek can replay `await`
  // beats synchronously without each replayed move bumping the index out from under us.
  const seekingRef = useRef(false);

  // Construct a fresh sandbox for this lesson (reset the store, apply the silent setup), store it in
  // the refs, and return it. Shared by the build effect, `restart`, and `seek`.
  const buildSandbox = useCallback((): SandboxSocket => {
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
        if (seekingRef.current) return;
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
    return sandbox;
  }, [lesson, store]);

  // Build (or rebuild) the sandbox for this lesson.
  useEffect(() => {
    buildSandbox();
    setIndex(0);
    setBuilt((n) => n + 1);
    return () => {
      sandboxRef.current = null;
      store.getState().reset();
    };
  }, [buildSandbox, store, nonce]);

  // Run an `auto` beat: fire its scripted action then advance. Suppressed while paused (autoplay
  // off) so the encyclopedia can hold a frame; the guided tutorial always autoplays.
  useEffect(() => {
    if (!autoplay) return;
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
  }, [index, lesson.beats, autoplay]);

  const next = useCallback(() => {
    const b = lesson.beats[idxRef.current];
    if (b && b.mode === 'info') setIndex((i) => i + 1);
  }, [lesson.beats]);

  const restart = useCallback(() => setNonce((n) => n + 1), []);

  const seek = useCallback(
    (target: number, performAwait?: PerformAwait) => {
      const clamped = Math.max(0, Math.min(lesson.beats.length, target));
      seekingRef.current = true;
      const sandbox = buildSandbox();
      const board = boardRef.current;
      for (let i = 0; board && i < clamped; i++) {
        const b = lesson.beats[i];
        if (!b) break;
        if (b.mode === 'auto') {
          sandbox.auto(
            typeof b.action === 'function' ? b.action(sandbox.getState(), board) : b.action,
          );
        } else if (b.mode === 'await') {
          performAwait?.(sandbox, b);
        }
      }
      seekingRef.current = false;
      setIndex(clamped);
      setBuilt((n) => n + 1);
    },
    [lesson, buildSandbox],
  );

  return {
    beat: lesson.beats[index] ?? null,
    index,
    total: lesson.beats.length,
    done: index >= lesson.beats.length,
    commands: sandboxRef.current,
    next,
    restart,
    seek,
  };
}
