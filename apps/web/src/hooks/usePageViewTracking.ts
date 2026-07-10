import { useEffect } from 'react';
import { useUi } from '../store/ui';
import { trackPageView } from '../lib/analytics';

// Maintainer-only routes are excluded from product analytics.
const SKIP = new Set(['adminReplay', 'adminSpectate']);

/** Fire a GA `page_view` on every SPA view change (Zaraz's automatic pageview only fires on hard
 *  navigation, so client-side route changes are otherwise invisible). */
export function usePageViewTracking(): void {
  const view = useUi((s) => s.view);
  useEffect(() => {
    if (SKIP.has(view)) return;
    trackPageView(view);
  }, [view]);
}
