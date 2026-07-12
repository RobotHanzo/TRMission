import { useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { useGameStore } from '../store/game';
import { useSettings } from '../store/settings';
import { cuesForEvents, type HapticCue } from './haptics';

const FIRE: Record<HapticCue, () => Promise<void>> = {
  'route-claim': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  'tunnel-reveal': () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  'ticket-complete': () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  'game-end': () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
};

/** Mount once inside GameStage. Fires once per event batch (the lastBatch.seq idiom the
 *  animation driver uses), so online, offline, and tutorial stages all buzz identically. */
export function useHaptics(): void {
  const enabled = useSettings((s) => s.haptics);
  const batch = useGameStore((s) => s.lastBatch);
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!batch || batch.seq === lastSeq.current) return;
    lastSeq.current = batch.seq;
    if (!enabled) return;
    for (const cue of cuesForEvents(batch.events)) {
      void FIRE[cue]().catch(() => undefined); // haptics are cosmetic; never surface errors
    }
  }, [batch, enabled]);
}
