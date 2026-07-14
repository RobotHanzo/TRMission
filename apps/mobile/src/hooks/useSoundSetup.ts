// Ported from apps/web/src/hooks/useSoundSetup.ts. No unlock listeners: native playback needs no
// user-gesture unlock (see sound/player.ts's unlock() no-op).
import { useEffect } from 'react';
import { useUi } from '../store/ui';
import { soundPlayer } from '../sound/player';

/**
 * Preload + keep the player synced with the per-device sound prefs. Mounted unconditionally near
 * the app root (see App.tsx) so a cue is playable the moment any screen wants one — including the
 * lobby, which (unlike the game) has no other reason to mount useSoundDriver. useSoundDriver also
 * calls this so a Game screen reached without ever visiting the lobby still works; both calls are
 * idempotent (preload() no-ops on cues already loaded).
 */
export function useSoundSetup(): void {
  useEffect(() => {
    void soundPlayer.preload();
    const { soundEnabled, soundVolume } = useUi.getState();
    soundPlayer.setEnabled(soundEnabled);
    soundPlayer.setVolume(soundVolume);
    return useUi.subscribe((s) => {
      soundPlayer.setEnabled(s.soundEnabled);
      soundPlayer.setVolume(s.soundVolume);
    });
  }, []);
}
