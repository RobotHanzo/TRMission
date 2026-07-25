/**
 * RNW-harness split of `googleMobileAds.ts`. The runtime `Platform.OS === 'web'` guard there is not
 * enough on its own: Metro still RESOLVES the `require('react-native-google-mobile-ads')` inside it
 * when bundling for web, and that package reaches into `react-native/Libraries/...` internals, which
 * Expo's web resolver rejects outright — the whole web bundle fails to build. Splitting the module
 * keeps the specifier out of the web graph entirely.
 *
 * Both exports are `null` here, exactly as the native module's web branch intends: every ad surface
 * renders nothing and every helper no-ops on the desktop testing harness.
 */
import type * as ExpoTrackingTransparency from 'expo-tracking-transparency';
import type * as GoogleMobileAds from 'react-native-google-mobile-ads';

export const GMA: typeof GoogleMobileAds | null = null;

export const TrackingTransparency: typeof ExpoTrackingTransparency | null = null;
