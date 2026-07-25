import { useHasFeature } from '../store/session';
import { useUi } from '../store/ui';
import { adUnitId, useAds, type AdPlacement } from './ads';

/**
 * Whether a placement may show right now: the SDK is up, consent allows requesting ads, the unit is
 * configured, and this account has not opted out.
 *
 * Opt-out parity with web's `AdSlot`: `hideAds` is honoured ONLY for accounts holding the `adFree`
 * feature. Both hooks run unconditionally — don't `&&` them into one, or the hook count changes
 * between renders when the account changes.
 */
export function useAdsVisible(placement: AdPlacement): boolean {
  const ready = useAds((s) => s.ready);
  const hasAdFree = useHasFeature('adFree');
  const hideAds = useUi((s) => s.hideAds);
  return ready && adUnitId(placement) !== '' && !(hasAdFree && hideAds);
}
