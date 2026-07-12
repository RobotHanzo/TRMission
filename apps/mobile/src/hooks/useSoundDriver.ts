// Ported from apps/web/src/hooks/useSoundDriver.ts with one delta: the web's
// window pointerdown/keydown unlock listeners are deleted — native playback needs no
// user-gesture unlock (soundPlayer.unlock() is a no-op here). Prefs subscribe stays on useUi.
import { useEffect, useRef } from 'react';
import { Phase } from '@trm/proto';
import { useGameStore, useGameStoreApi } from '../store/game';
import { useUi } from '../store/ui';
import { useChat } from '../store/chat';
import { soundPlayer } from '../sound/player';
import { OPPONENT_GAIN } from '../sound/cues';
import { cuesFromEvents, gameOverCue } from '../sound/soundModel';
import { completedByPlayer } from '../game/tickets';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Single sound driver, mounted once in GameStage beside useAnimationDriver. Plays cues from the
 * event stream and from snapshot diffs (game-over once on transition; mission-complete on a new
 * own-track completion). The first snapshot only seeds refs, so reconnect/resume never replays a
 * stale win-horn or mission flourish.
 *
 * @param sandbox Encyclopedia/replay sandboxes script a fake "viewer" turn on every looped beat;
 *   without this the yourTurn chime would fire on every loop of a demo nobody is actually playing.
 */
export function useSoundDriver(sandbox?: boolean): void {
  const gameStore = useGameStoreApi();
  const snapshot = useGameStore((s) => s.snapshot);
  const lastBatch = useGameStore((s) => s.lastBatch);
  const lastLiveChat = useChat((s) => s.lastLive);

  const seenBatchSeq = useRef(0);
  const seenChatId = useRef(0);
  const prevPhase = useRef<Phase | null>(null);
  const prevSelfCompleted = useRef<ReadonlySet<string> | null>(null);

  // Preload + keep the player synced with the per-device sound prefs.
  useEffect(() => {
    void soundPlayer.preload();
    const { soundEnabled, soundVolume } = useUi.getState();
    soundPlayer.setEnabled(soundEnabled);
    soundPlayer.setVolume(soundVolume);
    const unsub = useUi.subscribe((s) => {
      soundPlayer.setEnabled(s.soundEnabled);
      soundPlayer.setVolume(s.soundVolume);
    });
    return unsub;
  }, []);

  // Event-driven cues (draws, turn cue, station, route).
  useEffect(() => {
    if (!lastBatch || lastBatch.seq === seenBatchSeq.current) return;
    seenBatchSeq.current = lastBatch.seq;
    const snap = gameStore.getState().snapshot;
    if (!snap) return;
    for (const { cue, isSelf } of cuesFromEvents(snap, lastBatch.events)) {
      if (sandbox && cue === 'yourTurn') continue;
      soundPlayer.play(cue, isSelf ? 1 : OPPONENT_GAIN);
    }
  }, [lastBatch, gameStore, sandbox]);

  // New chat messages (never fires for a reconnect's history backfill — see store/chat.ts).
  useEffect(() => {
    if (!lastLiveChat || lastLiveChat.id === seenChatId.current) return;
    seenChatId.current = lastLiveChat.id;
    const me = gameStore.getState().snapshot?.you?.playerId ?? null;
    soundPlayer.play('chatMessage', lastLiveChat.playerId === me ? 1 : OPPONENT_GAIN);
  }, [lastLiveChat, gameStore]);

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
        soundPlayer.play('missionComplete');
        break;
      }
    }
    prevSelfCompleted.current = selfCompleted;

    if (prevPhase.current !== Phase.GAME_OVER && snapshot.phase === Phase.GAME_OVER) {
      const cue = gameOverCue(snapshot);
      if (cue) soundPlayer.play(cue);
    }
    prevPhase.current = snapshot.phase;
  }, [snapshot]);
}
