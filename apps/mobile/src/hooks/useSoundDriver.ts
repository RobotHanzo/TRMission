import { useSoundDriver as useCoreSoundDriver } from '@trm/client-core/sound/useSoundDriver';
import { soundPlayer } from '../sound/player';
import { useSoundSetup } from './useSoundSetup';

/**
 * Native binding of the shared sound driver (@trm/client-core/sound/useSoundDriver). Mounted once
 * in GameStage beside useAnimationDriver. Countdown cues are NOT pre-scheduled here — the native
 * player has no audio clock and native timers aren't tab-throttled, so they fire from
 * useTurnCountdown's interval (components/game/TurnCountdown.tsx).
 *
 * @param sandbox Encyclopedia/replay sandboxes script a fake "viewer" turn on every looped beat;
 *   passed through so the yourTurn chime stays silent there.
 */
export function useSoundDriver(sandbox?: boolean): void {
  // Preload/enable-sync also runs at the app root (useSoundSetup) so the lobby has sound too;
  // called here as well so a game reached without ever visiting the lobby still works.
  useSoundSetup();
  useCoreSoundDriver(soundPlayer, { sandbox });
}
