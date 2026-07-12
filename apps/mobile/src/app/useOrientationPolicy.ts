import { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

/** Pure policy: smallest side < 600dp is a phone (portrait-locked); anything else stays free. */
export const orientationLockFor = (width: number, height: number): 'portrait' | 'unlocked' =>
  Math.min(width, height) < 600 ? 'portrait' : 'unlocked';

/**
 * Phones (smallest side < 600dp) are portrait-locked; tablets stay unlocked.
 * NOTE this is a preference, not a guarantee: iPadOS 26 ignores requireFullScreen and
 * Android 16 ignores orientation locks on ≥600dp screens — every layout must survive live
 * resizing regardless (which is why tiers derive from useWindowDimensions, never device class).
 */
export function useOrientationPolicy(): void {
  const { width, height } = useWindowDimensions();
  const lock = orientationLockFor(width, height);
  useEffect(() => {
    if (lock === 'portrait') {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => undefined,
      );
    } else {
      void ScreenOrientation.unlockAsync().catch(() => undefined);
    }
  }, [lock]);
}
