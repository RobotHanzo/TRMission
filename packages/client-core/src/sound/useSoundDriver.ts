import { useEffect, useRef } from 'react';
import { Phase } from '@trm/proto';
import { useGameStore, useGameStoreApi } from '../store/game';
import { useChat } from '../store/chat';
import { completedByPlayer } from '../game/tickets';
import { COUNTDOWN_WARN_MS } from '../game/turnCountdown';
import { OPPONENT_GAIN } from './cues';
import { cuesFromEvents, gameOverCue } from './soundModel';
import type { SoundPlayer } from './player';

const EMPTY: ReadonlySet<string> = new Set();

export interface SoundDriverOptions {
  /**
   * Encyclopedia/replay sandboxes script a fake "viewer" turn on every looped beat; without this
   * the yourTurn chime would fire on every loop of a demo nobody is actually playing (and the
   * countdown cues would arm for a timer that isn't a real one).
   */
  sandbox?: boolean | undefined;
  /**
   * Pre-schedule the per-turn countdown cues on the player's audio clock (web). Off by default:
   * mobile fires the same cues from the visible countdown's interval (`useTurnCountdown`), so
   * turning this on there would double them up.
   */
  scheduleCountdownCues?: boolean | undefined;
}

/**
 * The single sound driver, shared by web and mobile and mounted once beside each client's
 * animation driver. Plays cues from the event stream and from snapshot diffs (game-over once on
 * transition; mission-complete on a new own-track completion). The first snapshot only seeds refs,
 * so reconnect/resume never replays a stale win-horn or mission flourish.
 *
 * The platform passes in its own {@link SoundPlayer}; everything else — which events sound, at what
 * gain, and the ordering guards — lives here.
 */
export function useSoundDriver(player: SoundPlayer, opts: SoundDriverOptions = {}): void {
  const { sandbox, scheduleCountdownCues } = opts;
  const gameStore = useGameStoreApi();
  const snapshot = useGameStore((s) => s.snapshot);
  const lastBatch = useGameStore((s) => s.lastBatch);
  const lastLiveChat = useChat((s) => s.lastLive);
  const turnTimer = useGameStore((s) => s.turnTimer);
  const myId = useGameStore((s) => s.snapshot?.you?.playerId ?? null);

  const seenBatchSeq = useRef(0);
  const seenChatId = useRef(0);
  const prevPhase = useRef<Phase | null>(null);
  const prevSelfCompleted = useRef<ReadonlySet<string> | null>(null);

  // Event-driven cues (draws, turn cue, station, route).
  useEffect(() => {
    if (!lastBatch || lastBatch.seq === seenBatchSeq.current) return;
    seenBatchSeq.current = lastBatch.seq;
    const snap = gameStore.getState().snapshot;
    if (!snap) return;
    for (const { cue, isSelf } of cuesFromEvents(snap, lastBatch.events)) {
      if (sandbox && cue === 'yourTurn') continue;
      player.play(cue, isSelf ? 1 : OPPONENT_GAIN);
    }
  }, [lastBatch, gameStore, sandbox, player]);

  // New chat messages (never fires for a reconnect's history backfill — see store/chat.ts).
  useEffect(() => {
    if (!lastLiveChat || lastLiveChat.id === seenChatId.current) return;
    seenChatId.current = lastLiveChat.id;
    const me = gameStore.getState().snapshot?.you?.playerId ?? null;
    player.play('chatMessage', lastLiveChat.playerId === me ? 1 : OPPONENT_GAIN);
  }, [lastLiveChat, gameStore, player]);

  // Countdown cues, pre-scheduled on the AUDIO clock the moment the server (re)arms the local
  // player's timer. The visual ring ticks on a setInterval (useTurnCountdown), but hidden tabs
  // clamp timers to 1s — and to once per MINUTE after 5 minutes hidden — so interval-driven
  // sounds miss the whole warning window while the site is unfocused/minimized. The audio clock
  // keeps time regardless of focus, and the timer frame itself arrives over the WS (also
  // unthrottled), so these land on time even in a background tab. A replaced/cleared timer
  // (the player acted, turn handover, game over) cancels everything still pending.
  useEffect(() => {
    if (!scheduleCountdownCues || !player.schedule) return;
    if (sandbox || !turnTimer || myId === null || turnTimer.playerId !== myId) return;
    const rem = turnTimer.deadline - Date.now();
    if (rem <= 0) return;
    const cancels: Array<() => void> = [];
    // One tick at each moment "sec seconds remaining" begins (skipping boundaries already past —
    // if the timer arrives mid-window the current second's tick fires ~immediately at offset 0).
    for (let sec = 1; sec * 1000 <= COUNTDOWN_WARN_MS; sec++) {
      const at = rem - sec * 1000;
      if (at > -1000) cancels.push(player.schedule('countdownWarning', Math.max(0, at)));
    }
    cancels.push(player.schedule('countdownLapsed', rem));
    return () => {
      for (const cancel of cancels) cancel();
    };
  }, [turnTimer, myId, sandbox, scheduleCountdownCues, player]);

  // Snapshot diffs: game-over (once) + self mission completion.
  useEffect(() => {
    if (!snapshot) {
      prevPhase.current = null;
      prevSelfCompleted.current = null;
      return;
    }
    const me = snapshot.you?.playerId ?? null;
    const selfCompleted = (me ? completedByPlayer(snapshot).get(me) : null) ?? EMPTY;

    if (prevSelfCompleted.current === null) {
      // First snapshot (or after reset): seed without firing.
      prevSelfCompleted.current = selfCompleted;
      prevPhase.current = snapshot.phase;
      return;
    }

    for (const id of selfCompleted) {
      if (!prevSelfCompleted.current.has(id)) {
        player.play('missionComplete');
        break;
      }
    }
    prevSelfCompleted.current = selfCompleted;

    if (prevPhase.current !== Phase.GAME_OVER && snapshot.phase === Phase.GAME_OVER) {
      const cue = gameOverCue(snapshot);
      if (cue) player.play(cue);
    }
    prevPhase.current = snapshot.phase;
  }, [snapshot, player]);
}
