// Google AdSense: MANUAL ad-unit helpers + a one-time library loader.
//
// The master switch, the publisher id, and the per-placement ad-unit ids come from the checked-in
// static config in config/adsense.ts (they are not secret — they ship in the client HTML anyway).
// Ads are OFF unless that config has `enabled: true` AND a real `ca-pub-…` id, so a disabled or
// unconfigured build renders no ad markup at all — every <AdSlot /> returns null.
//
// Manual units (not Auto ads) on purpose: this is an SPA with a zustand view router, so there are no
// full page loads for Auto ads to hook. Each <AdSlot /> requests once on mount and re-requests only
// when React remounts it — i.e. on a real view change (screens are conditionally rendered in App.tsx).

import { ADSENSE } from '../config/adsense';

export type AdPlacement = keyof typeof ADSENSE.slots;

/** The `ca-pub-…` publisher id, or '' when ads are not configured for this build. */
export const adClient = (): string => ADSENSE.client;

/** Ads only render when the master switch is on AND a real publisher id is present. */
export const adsEnabled = (): boolean => ADSENSE.enabled && ADSENSE.client.startsWith('ca-pub-');

/** The ad-unit id for a placement, or '' if it hasn't been configured. */
export const adSlotId = (placement: AdPlacement): string => ADSENSE.slots[placement];

const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

let scriptInjected = false;

/**
 * Inject the AdSense library once per page (module-level singleton). No-op when ads are disabled or
 * already injected. The script drains any queued `window.adsbygoogle` push on load, so callers may
 * push a fill request before the script has finished loading.
 */
export function ensureAdSenseScript(): void {
  if (scriptInjected || !adsEnabled() || typeof document === 'undefined') return;
  scriptInjected = true;
  const script = document.createElement('script');
  script.src = `${ADSENSE_SRC}?client=${encodeURIComponent(adClient())}`;
  script.async = true;
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** Queue a fill request for the most recently mounted `<ins class="adsbygoogle">` element. */
export function pushAd(): void {
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {
    // AdSense throws if pushed with no fillable slot (e.g. a StrictMode double-invoke, or a slot in
    // a zero-width container). Both are benign here — swallow rather than crash the view.
  }
}
