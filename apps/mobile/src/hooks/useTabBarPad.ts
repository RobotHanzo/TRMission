import { useContext } from 'react';
import { Platform } from 'react-native';
import { BottomTabBarHeightContext } from 'react-native-bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** A classic (pre-Liquid-Glass) iOS tab bar's own content height, excluding the bottom safe area.
 *  The floor below is built from it; see why it is a floor and not the measured value. */
const IOS_TAB_BAR_CONTENT_H = 49;

/** Bottom padding a HomeTabs tab screen must reserve for the floating native tab bar. On iOS the
 *  UITabBarController lays screen content full-bleed under the (Liquid Glass) bar, so buttons at
 *  the scroll end would sit behind it — the native side measures the bar's frame height and reports
 *  it through this context. 0 on Android, where the native tab view is a vertical LinearLayout
 *  whose content area already ends above the bar. Reads the context directly (not the library's
 *  `useBottomTabBarHeight`, which throws outside the navigator) so screens still render standalone
 *  in unit tests — same pattern as useGlassHeaderPad. `useTabBarPad.web.ts` is the RNW-harness
 *  split (JS tab bar, 0).
 *
 *  The measured height is a FLOOR, not the answer, for two reasons (issue #54):
 *   - It starts at 0 and only becomes real once the native `onTabBarMeasured` event lands, so an
 *     early layout — the docked ad banner in particular — would otherwise be placed under the bar.
 *   - The reported value is `UITabBar.frame.size.height`. On the classic bar that frame runs to the
 *     bottom of the screen, so it already includes the home-indicator inset; the iOS 26 bar FLOATS
 *     above that inset, so its frame is just the pill and the padding falls ~one safe-area short —
 *     exactly enough for the glass pill to cover the bottom of the banner.
 *  `insets.bottom + IOS_TAB_BAR_CONTENT_H` reproduces the classic bar's own height exactly (so
 *  nothing changes there) and clears the floating pill with a few points to spare. */
export function useTabBarPad(): number {
  const height = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'ios') return 0;
  return Math.max(height ?? 0, insets.bottom + IOS_TAB_BAR_CONTENT_H);
}
