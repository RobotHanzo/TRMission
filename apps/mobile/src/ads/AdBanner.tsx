// The app's one banner surface: an anchored adaptive banner docked at the bottom of the browse
// screens (Home, Encyclopedia contents, Leaderboard, History). Never on a game board, a room lobby,
// the tutorial, or any sandbox demo — see docs/plans/2026-07-25-mobile-admob.md for the policy
// reasoning (AdMob forbids banners on screens users continuously interact with, and next to
// interactive controls).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarPad } from '../hooks/useTabBarPad';
import { useTheme } from '../theme/useTheme';
import { adUnitId } from './ads';
import { GMA } from './googleMobileAds';
import { useAdsVisible } from './useAdsVisible';

/** Clearance between the unit and the floating iOS tab bar. Scroll CONTENT may end flush with that
 *  bar (it scrolls under the glass, which is the point), but a fixed dock that stops exactly on its
 *  top edge reads as sliding underneath it — the pill floats, and its glass shadow bleeds upward
 *  over whatever is directly above (issue #54). */
const TAB_BAR_GAP = 8;

/**
 * Docked banner. Renders as a normal flow element at the END of a screen's column, so it can never
 * overlap the content above it (an anchored overlay would sit on top of the create/join controls —
 * exactly the accidental-click shape AdMob's banner guidance rules out).
 *
 * `tabBar` adds the floating iOS tab bar's height beneath the unit; without it the banner takes the
 * bottom safe-area inset itself, since it is the bottom-most thing on screen.
 */
export function AdBanner({ tabBar = false }: { tabBar?: boolean }): React.JSX.Element | null {
  // Nothing below runs — and no hook is called — when the module is absent (web harness / Expo Go)
  // or the unit is unconfigured. Both are build-time constants, so the branch is stable across
  // renders and the inner component's hooks are unconditional.
  if (!GMA || adUnitId('banner') === '') return null;
  return <LoadedAdBanner tabBar={tabBar} />;
}

function LoadedAdBanner({ tabBar }: { tabBar: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarPad = useTabBarPad();
  const visible = useAdsVisible('banner');
  // The native bottom tabs keep every tab screen mounted, so without this the app would hold four
  // live banner requests at once and burn impressions on screens nobody is looking at.
  const focused = useIsFocused();
  // Collapse to nothing until an ad actually fills: an empty labelled strip on a no-fill would be
  // chrome that means nothing to the user.
  const [filled, setFilled] = useState(false);

  const gma = GMA;
  if (!gma || !visible || !focused) return null;

  const Banner = gma.BannerAd;
  return (
    <View
      testID="ad-banner"
      style={[
        styles.dock,
        filled && { borderTopColor: tokens.line, borderTopWidth: StyleSheet.hairlineWidth },
        // Paints the page colour itself: the strip it reserves for the floating tab bar sits
        // OUTSIDE the host screen's own scroll container, so an unpainted dock leaves a bare
        // black band under the page (issue #54).
        {
          backgroundColor: tokens.paper,
          paddingBottom: tabBar ? tabBarPad + TAB_BAR_GAP : insets.bottom,
        },
      ]}
    >
      {/* AdMob requires ads be distinguishable from app content; the same label web's AdSlot uses. */}
      {filled && <Text style={[styles.label, { color: tokens.inkSoft }]}>{t('ads.label')}</Text>}
      <Banner
        unitId={adUnitId('banner')}
        size={gma.BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER}
        onAdLoaded={() => setFilled(true)}
        onAdFailedToLoad={() => setFilled(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { alignItems: 'center' },
  label: { fontSize: 10, letterSpacing: 0.5, paddingTop: 2 },
});
