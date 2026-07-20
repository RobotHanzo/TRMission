// Google AdSense configuration + one-time library loader for the MANUAL ad units this app places.
//
// Ads are OFF unless VITE_ADSENSE_CLIENT is set to a `ca-pub-…` publisher id at build time. So dev,
// vitest, and any deploy without the env var render no ad markup at all — every <AdSlot /> returns
// null, which is why the existing screen tests are unaffected. Each placement also needs its own
// ad-unit id (VITE_ADSENSE_SLOT_*); a placement with no id renders nothing, so partial config is safe.
//
// Manual units (not Auto ads) on purpose: this is an SPA with a zustand view router, so there are no
// full page loads for Auto ads to hook. Each <AdSlot /> requests once on mount and re-requests only
// when React remounts it — i.e. on a real view change (screens are conditionally rendered in App.tsx).
//
// Env access is via literal `import.meta.env.VITE_*` member reads (dynamic `env[key]` would NOT be
// statically replaced by Vite in a production build) done inside functions (so vitest `vi.stubEnv`
// can exercise the enabled path).

export type AdPlacement =
  | 'landingTop'
  | 'landingInline'
  | 'home'
  | 'history'
  | 'room'
  | 'privacy'
  | 'postgame'
  | 'comms';

/** The `ca-pub-…` publisher id, or '' when ads are not configured for this build. */
export const adClient = (): string => (import.meta.env.VITE_ADSENSE_CLIENT ?? '') as string;

/** Ads only render when a real publisher id is present. */
export const adsEnabled = (): boolean => adClient().startsWith('ca-pub-');

/** The ad-unit id for a placement, or '' if it hasn't been configured. */
export function adSlotId(placement: AdPlacement): string {
  switch (placement) {
    case 'landingTop':
      return (import.meta.env.VITE_ADSENSE_SLOT_LANDING_TOP ?? '') as string;
    case 'landingInline':
      return (import.meta.env.VITE_ADSENSE_SLOT_LANDING_INLINE ?? '') as string;
    case 'home':
      return (import.meta.env.VITE_ADSENSE_SLOT_HOME ?? '') as string;
    case 'history':
      return (import.meta.env.VITE_ADSENSE_SLOT_HISTORY ?? '') as string;
    case 'room':
      return (import.meta.env.VITE_ADSENSE_SLOT_ROOM ?? '') as string;
    case 'privacy':
      return (import.meta.env.VITE_ADSENSE_SLOT_PRIVACY ?? '') as string;
    case 'postgame':
      return (import.meta.env.VITE_ADSENSE_SLOT_POSTGAME ?? '') as string;
    case 'comms':
      return (import.meta.env.VITE_ADSENSE_SLOT_COMMS ?? '') as string;
  }
}

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
