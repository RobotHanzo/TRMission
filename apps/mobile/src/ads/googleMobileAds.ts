import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import type * as ExpoTrackingTransparency from 'expo-tracking-transparency';
import type * as GoogleMobileAds from 'react-native-google-mobile-ads';

/**
 * `react-native-google-mobile-ads` is a third-party native module, so it is never bundled into Expo
 * Go — importing it there resolves to a stub whose first call throws. It has no web
 * implementation either, and the react-native-web harness is a desktop testing surface that must
 * never request a real ad. Load it lazily behind this guard: `null` in both places (every ad
 * surface renders nothing and every helper no-ops), the real module in dev/production builds.
 *
 * Same shape as `../push/expoNotifications.ts` and `../auth/googleSigninModule.ts` — see
 * `../push/CLAUDE.md`.
 */
export const GMA: typeof GoogleMobileAds | null =
  Platform.OS === 'web' || isRunningInExpoGo()
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('react-native-google-mobile-ads') as typeof GoogleMobileAds);

/**
 * `expo-tracking-transparency` (ATT). Gated identically: ATT is an iOS-only OS prompt with no
 * meaning in a browser tab, and Expo Go's own Info.plist — not ours — would back the request.
 */
export const TrackingTransparency: typeof ExpoTrackingTransparency | null =
  Platform.OS !== 'ios' || isRunningInExpoGo()
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('expo-tracking-transparency') as typeof ExpoTrackingTransparency);
