// The encyclopedia's calm auto-playing demo driver, shared web+mobile: pacing, the on-behalf
// performance of `await` beats (the demo has no learner), and the play/pause/step/loop machine
// over useScenarioPlayer. Each platform renders its own chrome around the returned controls.
import { useCallback, useEffect, useRef, useState } from 'react';
import { asPlayerId } from '@trm/shared';
import { legalActions } from '@trm/engine';
import type { SandboxSocket } from '../net/sandboxSocket';
import type { GameStoreApi } from '../store/game';
import type { ExpectSpec, Lesson } from './types';
import { useScenarioPlayer, type PerformAwait, type ScenarioPlayer } from './useScenarioPlayer';

// Calm auto-advance pacing for the read-first demo (ms). `info` beats linger long enough to read
// the caption unhurried; `await` beats are auto-performed after a short pause; the finished clip
// loops back. (The viewer can also pause and step through beats with the back/forward controls.)
export const INFO_MS = 4200;
export const AWAIT_MS = 1600;
export const LOOP_PAUSE_MS = 3400;

/** Perform an `await` beat on the viewer's behalf (the encyclopedia demo has no learner, so it
 *  plays the highlighted move for them). CLAIM_ROUTE/BUILD_STATION pick the first legal payment
 *  for the beat's target (mirrors what the guided tutorial's real learner would click);
 *  RESOLVE_TUNNEL stays unsupported — that demo is authored as an `auto` beat instead. */
export function performAwait(cmd: SandboxSocket, expect: ExpectSpec, viewer: string): void {
  const state = cmd.getState();
  const player = asPlayerId(viewer);
  switch (expect.t) {
    case 'DRAW_ANY':
    case 'DRAW_BLIND':
      return cmd.drawBlind();
    case 'DRAW_FACEUP':
      return cmd.drawFaceUp(
        Math.max(
          0,
          state.market.findIndex((c) => c !== null),
        ),
      );
    case 'DRAW_TICKETS':
      return cmd.drawTickets();
    case 'PASS':
      return cmd.pass();
    case 'KEEP_INITIAL_TICKETS':
      return cmd.keepInitialTickets([...(state.players[viewer]?.pendingTicketOffer ?? [])]);
    case 'KEEP_TICKETS':
      return cmd.keepTickets([...(state.players[viewer]?.pendingTicketOffer ?? [])].slice(0, 1));
    case 'CLAIM_ROUTE': {
      const action = legalActions(cmd.getBoard(), state, player).find(
        (a) => a.t === 'CLAIM_ROUTE' && (!expect.routeId || a.routeId === expect.routeId),
      );
      if (action) cmd.auto(action);
      return;
    }
    case 'BUILD_STATION': {
      const action = legalActions(cmd.getBoard(), state, player).find(
        (a) => a.t === 'BUILD_STATION' && (!expect.cityId || a.cityId === expect.cityId),
      );
      if (action) cmd.auto(action);
      return;
    }
    default:
      return; // unsupported await mechanism — leave to the manual replay control
  }
}

export interface EncyclopediaDemo {
  player: ScenarioPlayer;
  playing: boolean;
  setPlaying(next: boolean | ((v: boolean) => boolean)): void;
  /** Pause, then rebuild-and-replay to the neighbouring beat. */
  stepTo(target: number): void;
  restartAndPlay(): void;
}

export function useEncyclopediaDemo(entry: Lesson, store: GameStoreApi): EncyclopediaDemo {
  const [playing, setPlaying] = useState(true);
  // Paused → `auto` beats hold their frame too (so stepping/pausing freezes the whole demo).
  const player = useScenarioPlayer(entry, store, playing);
  // A stable ref so the single timer effect always acts on the latest player API without having
  // to re-subscribe (and re-time) on every parent render.
  const playerRef = useRef<ScenarioPlayer>(player);
  playerRef.current = player;

  // Replays an `await` beat for the viewer when a manual seek lands past it.
  const performAwaitBeat = useCallback<PerformAwait>(
    (cmd, b) => {
      if (b.mode === 'await') performAwait(cmd, b.expect, entry.viewer);
    },
    [entry.viewer],
  );
  const stepTo = useCallback(
    (target: number): void => {
      setPlaying(false);
      playerRef.current.seek(target, performAwaitBeat);
    },
    [performAwaitBeat],
  );
  const restartAndPlay = useCallback((): void => {
    playerRef.current.restart();
    setPlaying(true);
  }, []);

  // The one calm driver. While playing: an `info` beat waits a readable moment then advances; an
  // `await` beat is performed for the viewer; an `auto` beat is already advanced inside the
  // scenario player. When the clip finishes it loops back to the start after a gentle pause.
  useEffect(() => {
    if (!playing) return;
    const p = playerRef.current;
    if (p.done) {
      const id = setTimeout(() => playerRef.current.restart(), LOOP_PAUSE_MS);
      return () => clearTimeout(id);
    }
    const b = p.beat;
    if (!b) return;
    if (b.mode === 'info') {
      const id = setTimeout(() => playerRef.current.next(), INFO_MS);
      return () => clearTimeout(id);
    }
    if (b.mode === 'await') {
      const cmd = p.commands;
      if (!cmd) return;
      const id = setTimeout(() => performAwait(cmd, b.expect, entry.viewer), AWAIT_MS);
      return () => clearTimeout(id);
    }
    return; // 'auto' beats self-advance in useScenarioPlayer
  }, [playing, player.index, player.done, entry.viewer]);

  return { player, playing, setPlaying, stepTo, restartAndPlay };
}
