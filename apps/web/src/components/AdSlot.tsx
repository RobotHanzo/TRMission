import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  adClient,
  adsEnabled,
  adSlotId,
  ensureAdSenseScript,
  pushAd,
  type AdPlacement,
} from '../lib/ads';
import '../styles/ads.css';

interface AdSlotProps {
  placement: AdPlacement;
  /** `data-ad-format`; 'auto' (responsive) by default. */
  format?: string;
  /** Only render at/above this viewport width (px). Used to pin the in-game unit to ≥1300px. */
  minWidthPx?: number;
  /** Reserve this much vertical space (px) so filling the slot doesn't shift layout (CLS). */
  reserveHeight?: number;
  className?: string;
}

/**
 * A single policy-safe AdSense unit. Renders nothing unless a publisher id (VITE_ADSENSE_CLIENT) and
 * this placement's unit id are both configured — so it is inert in dev and tests. Always carries a
 * visible "Advertisement / 廣告" label and a bounding rule (AdSense forbids blending ads with UI),
 * and reserves height up front to avoid layout shift while the ad fills.
 *
 * SPA note: each screen is conditionally rendered in App.tsx, so an <AdSlot /> mounts fresh (and
 * requests once) on every real view change; there are no full page loads for Auto ads to hook.
 */
export function AdSlot({
  placement,
  format = 'auto',
  minWidthPx,
  reserveHeight = 100,
  className,
}: AdSlotProps) {
  const { i18n } = useTranslation();
  // Hooks must run unconditionally; a 0px floor makes the no-minWidth case always match.
  const wide = useMediaQuery(`(min-width: ${minWidthPx ?? 0}px)`);
  const pushedRef = useRef(false);

  const slot = adSlotId(placement);
  const show = adsEnabled() && slot !== '' && (!minWidthPx || wide);

  useEffect(() => {
    if (!show) {
      // Below the width gate (or disabled): allow a fresh push if the slot later reappears.
      pushedRef.current = false;
      return;
    }
    ensureAdSenseScript();
    if (pushedRef.current) return; // StrictMode double-invoke / re-render: push exactly once per mount
    pushedRef.current = true;
    pushAd();
  }, [show]);

  if (!show) return null;

  const label = i18n.language.startsWith('zh') ? '廣告' : 'Advertisement';
  return (
    <aside className={`ad-slot${className ? ` ${className}` : ''}`} aria-label={label}>
      <span className="ad-slot-label">{label}</span>
      <ins
        className="adsbygoogle ad-slot-ins"
        style={{ display: 'block', minHeight: reserveHeight }}
        data-ad-client={adClient()}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </aside>
  );
}
