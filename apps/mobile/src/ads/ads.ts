// Google AdMob for apps/mobile (issue #50): SDK bring-up, the consent gate, and the ad-unit ids
// every placement resolves through. Placement rationale + policy notes: docs/plans/2026-07-25-mobile-admob.md.
//
// Nothing here talks to the network until `initAds()` has run, and `initAds()` is deliberately NOT
// called from `index.ts` like Sentry is: the UMP consent form and the ATT prompt are native modals,
// and Apple requires the app to be visibly foregrounded before ATT is requested. App.tsx fires it
// once the boot chain has released the splash.
import { create } from 'zustand';
import { ADMOB_BANNER_UNIT_ID, ADMOB_ENABLED, ADMOB_OFFLINE_GAME_END_UNIT_ID } from '../config';
import { GMA, TrackingTransparency } from './googleMobileAds';

/** Every placement in the app. One ad unit each; see app.config.ts's ADMOB block. */
export type AdPlacement = 'banner' | 'offlineGameEnd';

/**
 * The unit id for a placement, or '' when it is not configured (⇒ that placement renders nothing).
 *
 * `__DEV__` always resolves to Google's test units regardless of what is checked in: clicking a
 * live ad on your own inventory is invalid traffic and can get the AdMob account suspended, so a
 * developer must never be able to reach one.
 */
export function adUnitId(placement: AdPlacement): string {
  if (!GMA || !ADMOB_ENABLED) return '';
  if (__DEV__) {
    return placement === 'banner' ? GMA.TestIds.ADAPTIVE_BANNER : GMA.TestIds.INTERSTITIAL;
  }
  return placement === 'banner' ? ADMOB_BANNER_UNIT_ID : ADMOB_OFFLINE_GAME_END_UNIT_ID;
}

interface AdsState {
  /** True once the SDK is initialised AND consent allows requesting ads. Until then: no requests. */
  ready: boolean;
  /**
   * True when UMP says this user must be offered a way back into their consent choices (EEA/UK and
   * regulated US states). Drives the Settings row — hidden entirely elsewhere, because
   * `showPrivacyOptionsForm()` throws where no form is required.
   */
  privacyOptionsRequired: boolean;
}

export const useAds = create<AdsState>()(() => ({ ready: false, privacyOptionsRequired: false }));

let started = false;

/**
 * Bring the Mobile Ads SDK up, in the order Google's UMP integration requires:
 *
 *  1. Gather consent (`gatherConsent` = requestInfoUpdate + show the form where required). This is
 *     the GDPR/regulated-state gate and it decides `canRequestAds`.
 *  2. THEN request ATT — after the consent form, so a user who has just been told what data is used
 *     for isn't hit by two modals in an unexplained order. Skipped unless the status is still
 *     undetermined (a second request is a no-op the OS never shows).
 *  3. Only then initialise the SDK, and only if consent actually allows ad requests.
 *
 * Every step swallows its own failure: an unreachable consent endpoint or a denied prompt must
 * degrade to "no ads", never to a broken app. Safe to call repeatedly; runs once.
 */
export async function initAds(): Promise<boolean> {
  if (started) return useAds.getState().ready;
  started = true;
  if (!GMA || !ADMOB_ENABLED) return false;

  try {
    await GMA.AdsConsent.gatherConsent();
  } catch {
    // Consent could not be gathered (offline, UMP outage). Fall through: getConsentInfo below still
    // reports the last known state, which for a user outside a regulated region is "can request".
  }

  if (TrackingTransparency) {
    try {
      const { status } = await TrackingTransparency.getTrackingPermissionsAsync();
      if (status === 'undetermined') await TrackingTransparency.requestTrackingPermissionsAsync();
    } catch {
      // Denied or unavailable — the SDK falls back to non-personalized ads on its own.
    }
  }

  try {
    const info = await GMA.AdsConsent.getConsentInfo();
    useAds.setState({
      privacyOptionsRequired:
        info.privacyOptionsRequirementStatus ===
        GMA.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
    });
    if (!info.canRequestAds) return false;

    // The app rates Everyone / PEGI 3 (docs/release/*), so ad content is capped to match.
    // `ageRestrictedTreatment` is deliberately left unset: the game is general-audience, not
    // primarily child-directed, and declaring CHILD is a legal certification, not a safety dial.
    await GMA.default().setRequestConfiguration({ maxAdContentRating: GMA.MaxAdContentRating.G });
    await GMA.default().initialize();
    useAds.setState({ ready: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-open the UMP privacy options form (the Settings row). Resolves to whether it was shown —
 * false when no form is required for this user, or the SDK refused.
 */
export async function showAdPrivacyOptions(): Promise<boolean> {
  if (!GMA || !useAds.getState().privacyOptionsRequired) return false;
  try {
    await GMA.AdsConsent.showPrivacyOptionsForm();
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forget that `initAds` ran. Never call this from app code. */
export function resetAdsForTest(): void {
  started = false;
  useAds.setState({ ready: false, privacyOptionsRequired: false });
}
