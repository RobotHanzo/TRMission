import { useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { useSettings } from '../store/settings';

/**
 * Wraps a `RefreshControl` handler so the pull that fires it also buzzes (issue #61): the drag
 * crosses its threshold under the thumb, where the spinner it spawns is hidden, so touch is the
 * only confirmation that arrives on time. A light impact — the platform idiom for "that gesture
 * took", not an event worth a notification buzz.
 *
 * Gated by the same device-local `settings.haptics` switch as the in-game cues
 * (`../game/useHaptics`), and equally cosmetic: a rejected native call is swallowed.
 */
export function useRefreshHaptics(onRefresh: () => void): () => void {
  const enabled = useSettings((s) => s.haptics);
  return useCallback(() => {
    if (enabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    onRefresh();
  }, [enabled, onRefresh]);
}
