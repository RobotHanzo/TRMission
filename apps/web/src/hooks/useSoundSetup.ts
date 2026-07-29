import { useEffect } from 'react';
import { useSoundSetup as useCoreSoundSetup } from '@trm/client-core/sound/useSoundSetup';
import { useUi } from '../store/ui';
import { soundPlayer } from '../sound/player';

/**
 * Web binding of the shared preload/prefs sync (@trm/client-core/sound/useSoundSetup), plus the
 * one piece that is web-only: first-gesture unlock for the autoplay policy. Mounted
 * unconditionally near the app root (see App.tsx) so a cue is playable the moment any screen wants
 * one — including the lobby, which (unlike the game) has no other reason to mount useSoundDriver.
 * useSoundDriver also calls this so a GameScreen-only reload still works; both calls are idempotent.
 */
export function useSoundSetup(): void {
  useCoreSoundSetup(soundPlayer, useUi);
  useEffect(() => {
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
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
