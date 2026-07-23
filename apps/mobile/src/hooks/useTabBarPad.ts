import { useContext } from 'react';
import { Platform } from 'react-native';
import { BottomTabBarHeightContext } from 'react-native-bottom-tabs';

/** Bottom padding a HomeTabs tab screen must reserve for the floating native tab bar. On iOS the
 *  UITabBarController lays screen content full-bleed under the (Liquid Glass) bar, so buttons at
 *  the scroll end would sit behind it — the native side measures the bar's frame height (which
 *  spans down through the home-indicator region) and reports it through this context. 0 on
 *  Android, where the native tab view is a vertical LinearLayout whose content area already ends
 *  above the bar. Reads the context directly (not the library's `useBottomTabBarHeight`, which
 *  throws outside the navigator) so screens still render standalone in unit tests — same pattern
 *  as useGlassHeaderPad. `useTabBarPad.web.ts` is the RNW-harness split (JS tab bar, 0). */
export function useTabBarPad(): number {
  const height = useContext(BottomTabBarHeightContext);
  return Platform.OS === 'ios' ? (height ?? 0) : 0;
}
