// The native-app nudge for phone/tablet browsers (issue #106): which store this device can be sent
// to, and the one-shot dismissal behind it. Web-only on purpose — it reads `navigator`, and mobile
// has nothing to promote (it IS the app), so this never belongs in @trm/client-core.

/** Platforms with a PUBLIC store listing to send a visitor to.
 *
 *  Android is deliberately absent: the Play listing is still an internal-testing track, and
 *  `play.google.com/store/apps/details?id=…` answers "item not found" for anyone who isn't an
 *  enrolled tester — a worse outcome than showing nothing. The day it goes public this becomes
 *  `'ios' | 'android'`, `STORE_URL` gains its `/android` vanity target (nginx.conf, same shape as
 *  `/ios`) plus Google's badge artwork, and the prompt lights up for it unchanged. */
export type MobilePlatform = 'ios';

/** iPadOS 13+ Safari ships "Request Desktop Website" ON by default for iPad, so it reports a
 *  Macintosh UA and the UA test alone misses every iPad. No Mac has a touchscreen, so a
 *  touch-capable "MacIntel" is an iPad. */
function isIpadInDesktopMode(): boolean {
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** The store this browser should be offered, or `null` for "nothing to offer here" — a desktop
 *  browser, or a mobile one whose platform has no public listing yet. */
export function detectMobilePlatform(): MobilePlatform | null {
  if (typeof navigator === 'undefined') return null;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || isIpadInDesktopMode()) return 'ios';
  return null;
}

const DISMISS_KEY = 'trm.appPromptDismissed';

/** Per-device, and permanent once set: the prompt is an offer, so a visitor who has answered it
 *  once — by dismissing OR by leaving for the store — is never asked again on this browser. */
export function isAppPromptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // storage unavailable (private mode) — the in-memory state still closes it
  }
}

export function dismissAppPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}
