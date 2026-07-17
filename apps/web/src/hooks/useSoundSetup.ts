import { useEffect } from 'react';
import { useUi } from '../store/ui';
import { soundPlayer } from '../sound/player';

/**
 * Preload + first-gesture unlock + keep the player synced with the per-device sound prefs.
 * Mounted unconditionally near the app root (see App.tsx) so a cue is playable the moment any
 * screen wants one — including the lobby, which (unlike the game) has no other reason to mount
 * useSoundDriver. useSoundDriver also calls this so a GameScreen-only reload still works; both
 * calls are idempotent (preload() no-ops on cues already decoded, listeners are cleaned up per-effect).
 */
export function useSoundSetup(): void {
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
    // Also re-unlock when the tab becomes visible again: once the page has ever had a user
    // gesture, resume() succeeds without a fresh one, so sound recovers on return from a
    // minimized/background stint without waiting for the next click.
    const onVisible = () => {
      if (!document.hidden) soundPlayer.unlock();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsub();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
