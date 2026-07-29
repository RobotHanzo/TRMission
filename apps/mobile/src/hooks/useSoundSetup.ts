import { useSoundSetup as useCoreSoundSetup } from '@trm/client-core/sound/useSoundSetup';
import { useUi } from '../store/ui';
import { soundPlayer } from '../sound/player';

/**
 * Native binding of the shared preload/prefs sync (@trm/client-core/sound/useSoundSetup). No
 * unlock listeners: native playback needs no user-gesture unlock (see sound/player.ts's unlock()
 * no-op). Mounted near the app root (see App.tsx) and again by useSoundDriver — both idempotent.
 */
export function useSoundSetup(): void {
  useCoreSoundSetup(soundPlayer, useUi);
}
