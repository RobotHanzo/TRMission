import { useSoundDriver as useCoreSoundDriver } from '@trm/client-core/sound/useSoundDriver';
import { soundPlayer } from '../sound/player';
import { useSoundSetup } from './useSoundSetup';

/**
 * Web binding of the shared sound driver (@trm/client-core/sound/useSoundDriver): the web
 * player plus the countdown cues pre-scheduled on its audio clock, which is what keeps them on
 * time in a hidden tab. Mounted once in GameScreen beside useAnimationDriver.
 *
 * @param sandbox Encyclopedia/replay sandboxes script a fake "viewer" turn on every looped beat;
 *   passed through so the yourTurn chime stays silent there.
 */
export function useSoundDriver(sandbox?: boolean): void {
  // Preload/enable-sync/unlock also runs at the app root (useSoundSetup) so the lobby has sound
  // too; called here as well so a game reached without ever visiting the lobby still works.
  useSoundSetup();
  useCoreSoundDriver(soundPlayer, { sandbox, scheduleCountdownCues: true });
}
