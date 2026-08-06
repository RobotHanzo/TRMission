import { useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { useGameStore } from '../store/game';
import { useSettings } from '../store/settings';
import { cuesForEvents, type HapticCue } from './haptics';

/** Gap between the two pulses of the your-turn nudge — long enough to read as two taps. */
const TURN_PULSE_GAP_MS = 110;

const FIRE: Record<HapticCue, () => Promise<void>> = {
  'route-claim': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  'tunnel-reveal': () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  'ticket-complete': () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  'game-end': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  // Two crisp taps: every other beat is a single buzz, so the double pulse reads as "you're up"
  // without having to look at the screen.
  'your-turn': async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    await new Promise((resolve) => setTimeout(resolve, TURN_PULSE_GAP_MS));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
  },
};

/**
 * Mount once inside GameStage. Fires once per event batch (the lastBatch.seq idiom the
 * animation driver uses), so online, offline, and tutorial stages all buzz identically.
 *
 * @param playing True when the viewer is actually taking turns — the stage has commands and isn't
 *   a demo clip. Replay and encyclopedia clips script turns for a viewer who is only watching, so
 *   the your-turn nudge stays silent there (the same guard the yourTurn chime has in the sound
 *   driver); the four game beats still buzz for them.
 */
export function useHaptics(playing = false): void {
  const enabled = useSettings((s) => s.haptics);
  const batch = useGameStore((s) => s.lastBatch);
  const me = useGameStore((s) => s.snapshot?.you?.playerId ?? null);
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!batch || batch.seq === lastSeq.current) return;
    lastSeq.current = batch.seq;
    if (!enabled) return;
    for (const cue of cuesForEvents(batch.events, playing ? me : null)) {
      void FIRE[cue]().catch(() => undefined); // haptics are cosmetic; never surface errors
    }
  }, [batch, enabled, me, playing]);
}
