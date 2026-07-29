import { useEffect } from 'react';
import type { SoundPlayer } from './player';

/** The slice of an app's UI store this hook keeps the player synced with. */
export interface SoundPrefs {
  soundEnabled: boolean;
  soundVolume: number;
}

/**
 * A zustand store holding {@link SoundPrefs} (each app owns its own — web persists to
 * localStorage, mobile to AsyncStorage), reduced to what the sync needs.
 */
export interface SoundPrefsStore {
  getState(): SoundPrefs;
  subscribe(listener: (state: SoundPrefs) => void): () => void;
}

/**
 * Preload + keep the player synced with the per-device sound prefs. Mounted unconditionally near
 * the app root so a cue is playable the moment any screen wants one — including the lobby, which
 * (unlike the game) has no other reason to mount `useSoundDriver`. The driver calls it too, so a
 * game screen reached without ever visiting the lobby still works; both calls are idempotent
 * (`preload()` no-ops on cues already loaded).
 *
 * The web wrapper adds its autoplay-unlock listeners around this; native needs none.
 */
export function useSoundSetup(player: SoundPlayer, prefs: SoundPrefsStore): void {
  useEffect(() => {
    void player.preload();
    const { soundEnabled, soundVolume } = prefs.getState();
    player.setEnabled(soundEnabled);
    player.setVolume(soundVolume);
    return prefs.subscribe((s) => {
      player.setEnabled(s.soundEnabled);
      player.setVolume(s.soundVolume);
    });
    // Player and store are app-level singletons: run once, or a re-subscribe would pile up.
  }, []);
}
