import { useEffect, useRef } from 'react';
import { Phase } from '@trm/proto';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { soundPlayer } from '../sound/player';
import { OPPONENT_GAIN } from '../sound/cues';
import { cuesFromEvents, gameOverCue } from '../sound/soundModel';
import { completedByPlayer } from '../game/tickets';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Single sound driver, mounted once in GameScreen beside useAnimationDriver. Plays cues from the
 * event stream and from snapshot diffs (game-over once on transition; mission-complete on a new
 * own-track completion). The first snapshot only seeds refs, so reconnect/resume never replays a
 * stale win-horn or mission flourish.
 */
export function useSoundDriver(): void {
  const snapshot = useGame((s) => s.snapshot);
  const lastBatch = useGame((s) => s.lastBatch);

  const seenBatchSeq = useRef(0);
  const prevPhase = useRef<Phase | null>(null);
  const prevSelfCompleted = useRef<ReadonlySet<string> | null>(null);

  // Preload + first-gesture unlock + keep the player synced with the per-device sound prefs.
  useEffect(() => {
    void soundPlayer.preload();
    const { soundEnabled, soundVolume } = useUi.getState();
    soundPlayer.setEnabled(soundEnabled);
    soundPlayer.setVolume(soundVolume);
    const unsub = useUi.subscribe((s) => {
      soundPlayer.setEnabled(s.soundEnabled);
      soundPlayer.setVolume(s.soundVolume);
    });
    const unlock = () => soundPlayer.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      unsub();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Event-driven cues (draws, turn cue, station, route).
  useEffect(() => {
    if (!lastBatch || lastBatch.seq === seenBatchSeq.current) return;
    seenBatchSeq.current = lastBatch.seq;
    const snap = useGame.getState().snapshot;
    if (!snap) return;
    for (const { cue, isSelf } of cuesFromEvents(snap, lastBatch.events)) {
      soundPlayer.play(cue, isSelf ? 1 : OPPONENT_GAIN);
    }
  }, [lastBatch]);

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
