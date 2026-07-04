// Drives a finished game's action log through the LOCAL engine and projects each step through
// redactFor(viewer) → viewToSnapshot into an isolated game store — the same recipe as the
// tutorial sandbox (net/sandboxSocket.ts) plus seek, checkpoints, autoplay, and a switchable
// viewer. Forward steps animate (applyEvents + ingestLive); seeks rebuild silently and backfill
// the log in one shot (ingestHistory), mirroring how a live reconnect avoids re-animating.
import { useCallback, useEffect, useRef, useState } from 'react';
import { initGame, reduce, redactFor, cloneState, stateDigest } from '@trm/engine';
import type { Action, Board, GameConfig, GameState, GameEvent } from '@trm/engine';
import type { PlayerId } from '@trm/shared';
import { viewToSnapshot, eventToProto } from '@trm/codec';
import type { GameEvent as PbGameEvent } from '@trm/proto';
import { tunnelRevealMs } from '../../game/tunnel';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { GameStoreApi } from '../../store/game';
import type { LogStoreApi } from '../../store/log';

/** Auto-play cadence (ms per action) — near the tutorial's calm 900 ms beat. */
export const STEP_MS = 1100;
/** State checkpoints every N actions so seeks rebuild from nearby, not genesis. */
const CHECKPOINT_EVERY = 32;

export interface ReplayControls {
  step: number;
  total: number;
  playing: boolean;
  viewer: PlayerId | null;
  atEnd: boolean;
  error: boolean;
  /** True right after an animated forward step(); false after any silent rebuild (seek/prev/
   *  setViewer/initial mount) — the glide-vs-snap signal for the replay camera-follow. */
  animate: boolean;
  setViewer(viewer: PlayerId | null): void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(step: number): void;
}

export function useReplayPlayer(
  board: Board,
  config: GameConfig,
  actions: readonly Action[],
  initialViewer: PlayerId | null,
  stores: { game: GameStoreApi; log: LogStoreApi },
  finalDigest?: string,
): ReplayControls {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [viewer, setViewerState] = useState<PlayerId | null>(initialViewer);
  const [error, setError] = useState(false);
  const [animate, setAnimate] = useState(false);

  const stepRef = useRef(0);
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const reducedMotion = useReducedMotion();
  // Delay before the AUTOPLAY tick following the current step. Normally STEP_MS, but a step that
  // opens a tunnel reveal (TUNNEL_PENDING) extends this so the dialog's card-flip + surcharge
  // reveal finishes on screen before the next tick applies RESOLVE_TUNNEL and closes it.
  const nextDelay = useRef(STEP_MS);
  // Lazily-built caches: raw events emitted by action i, and periodic state checkpoints.
  // Both are viewer-agnostic (redaction happens at projection time).
  const eventsCache = useRef<GameEvent[][]>([]);
  const checkpoints = useRef<Map<number, GameState>>(new Map());
  // The single most-recently-produced state, keyed by step. `setViewer` always re-targets the
  // CURRENT step (only the projection changes, not the engine state) — this lets that case (and
  // any other same-step re-application) skip `stateAt`'s checkpoint-forward recompute entirely.
  const lastState = useRef<{ step: number; state: GameState } | null>(null);

  /** Engine state AFTER k actions, reducing forward from the nearest checkpoint and caching. */
  const stateAt = useCallback(
    (k: number): GameState => {
      let base = 0;
      for (const s of checkpoints.current.keys()) if (s <= k && s > base) base = s;
      let state = checkpoints.current.get(base);
      if (!state) {
        state = initGame(board, config);
        checkpoints.current.set(0, cloneState(state));
      }
      for (let i = base; i < k; i++) {
        const action = actions[i];
        if (!action) throw new Error(`replay: missing action ${i}`);
        const r = reduce(board, state, action);
        if (!r.ok) throw new Error(`replay: action ${i} (${action.t}) rejected: ${r.error.code}`);
        state = r.value.state;
        eventsCache.current[i] = [...r.value.events];
        const n = i + 1;
        if (n % CHECKPOINT_EVERY === 0 && !checkpoints.current.has(n)) {
          checkpoints.current.set(n, cloneState(state));
        }
      }
      return state;
    },
    [board, config, actions],
  );

  /** `stateAt`, short-circuited by `lastState` when re-targeting the step already produced —
   *  the common case for `setViewer`, so a perspective switch never re-runs `reduce()`. */
  const stateAtCached = useCallback(
    (k: number): GameState => {
      if (lastState.current && lastState.current.step === k) return lastState.current.state;
      const state = stateAt(k);
      lastState.current = { step: k, state };
      return state;
    },
    [stateAt],
  );

  const redactEvents = useCallback(
    (events: readonly GameEvent[], v: PlayerId | null): PbGameEvent[] =>
      events.map((e) => eventToProto(e, v)).filter((e): e is PbGameEvent => e !== null),
    [],
  );

  const project = useCallback(
    (state: GameState, v: PlayerId | null) => {
      const view = redactFor(board, state, v);
      stores.game.getState().applySnapshot(viewToSnapshot(view, state.actionSeq, v));
    },
    [board, stores.game],
  );

  /** Rebuild to `target` silently: reset stores (the snapshot guard drops older stateVersions),
   *  restore board state from the nearest checkpoint, backfill the redacted log, project once. */
  const applyTo = useCallback(
    (target: number, v: PlayerId | null) => {
      const clamped = Math.max(0, Math.min(actions.length, target));
      try {
        const state = stateAtCached(clamped);
        stores.game.getState().reset();
        stores.log.getState().reset();
        const past = eventsCache.current.slice(0, clamped).flat();
        stores.log.getState().ingestHistory(redactEvents(past, v));
        project(state, v);
        stepRef.current = clamped;
        setStep(clamped);
        setAnimate(false);
        nextDelay.current = STEP_MS;
      } catch {
        setError(true);
        setPlaying(false);
      }
    },
    [actions.length, stateAtCached, stores, redactEvents, project],
  );

  /** One animated forward step: reduce, project, and feed events to animations + the log. */
  const next = useCallback(() => {
    const cur = stepRef.current;
    if (cur >= actions.length) return;
    try {
      const before = stateAtCached(cur); // a cache hit after the first pass — no recompute
      const action = actions[cur];
      if (!action) return;
      const r = reduce(board, before, action);
      if (!r.ok) throw new Error(`replay: action ${cur} rejected`);
      const state = r.value.state;
      eventsCache.current[cur] = [...r.value.events];
      const n = cur + 1;
      if (n % CHECKPOINT_EVERY === 0 && !checkpoints.current.has(n)) {
        checkpoints.current.set(n, cloneState(state));
      }
      lastState.current = { step: n, state };
      const v = viewerRef.current;
      project(state, v);
      const pb = redactEvents(r.value.events, v);
      if (pb.length > 0) {
        stores.game.getState().applyEvents(state.actionSeq, pb);
        stores.log.getState().ingestLive(pb);
      }
      // A tunnel reveal just opened (TunnelModal will mount) — hold the AUTOPLAY tick that would
      // otherwise apply RESOLVE_TUNNEL next until the card-flip + surcharge reveal has had time
      // to play out, so the dialog isn't yanked away mid-animation.
      const tunnelRevealed = r.value.events.find(
        (e): e is Extract<GameEvent, { e: 'TUNNEL_REVEALED' }> => e.e === 'TUNNEL_REVEALED',
      );
      nextDelay.current = tunnelRevealed
        ? tunnelRevealMs(tunnelRevealed.revealed.length, reducedMotion) + STEP_MS
        : STEP_MS;
      stepRef.current = n;
      setStep(n);
      setAnimate(true);
    } catch {
      setError(true);
      setPlaying(false);
    }
  }, [actions, board, stateAtCached, project, redactEvents, stores, reducedMotion]);

  const seek = useCallback(
    (target: number) => {
      setPlaying(false);
      applyTo(target, viewerRef.current);
    },
    [applyTo],
  );

  const prev = useCallback(() => {
    setPlaying(false);
    applyTo(stepRef.current - 1, viewerRef.current);
  }, [applyTo]);

  const setViewer = useCallback(
    (v: PlayerId | null) => {
      setViewerState(v);
      applyTo(stepRef.current, v);
    },
    [applyTo],
  );

  const play = useCallback(() => {
    if (!error && stepRef.current < actions.length) setPlaying(true);
  }, [error, actions.length]);
  const pause = useCallback(() => setPlaying(false), []);

  // Mount: project genesis. Unmount: clear the (isolated) stores.
  useEffect(() => {
    applyTo(0, viewerRef.current);
    const { game, log } = stores;
    return () => {
      game.getState().reset();
      log.getState().reset();
    };
    // Mount-only by design: board/config/actions are memoized by the screen for the mount's life.
  }, []);

  // Autoplay: a setTimeout chain that re-arms after each applied step.
  useEffect(() => {
    if (!playing) return;
    if (error || stepRef.current >= actions.length) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(next, nextDelay.current);
    return () => clearTimeout(id);
  }, [playing, step, error, actions.length, next]);

  // Optional integrity seal at the end (diagnostic only — never blocks the UX).
  useEffect(() => {
    if (!finalDigest || step !== actions.length || actions.length === 0) return;
    try {
      if (stateDigest(stateAtCached(actions.length)) !== finalDigest) {
        console.warn('[replay] final state digest mismatch — engine/content drift?');
      }
    } catch {
      /* surfaced via `error` already */
    }
  }, [step, actions.length, finalDigest, stateAtCached]);

  return {
    step,
    total: actions.length,
    playing,
    viewer,
    atEnd: step >= actions.length,
    error,
    animate,
    setViewer,
    play,
    pause,
    next,
    prev,
    seek,
  };
}
