import { useEffect, useState } from 'react';
import { resolveContent } from './contentCache';
import { setActiveContent, resetToDefaultContent } from './catalog';

export type ActiveContentStatus = 'loading' | 'ready' | 'error';

/**
 * Resolves `hash` to GameContent and makes it the active board catalog (content.ts's CITIES/
 * ROUTES/etc., routeGeometry.ts's ROUTE_GEOMETRY, catalog.ts's ACTIVE_BASE_VIEW/ACTIVE_GEOGRAPHY)
 * for as long as the calling component stays mounted with that hash. Resets to the default
 * (Taiwan) catalog on unmount, so leaving a custom-map game/replay never leaks its content into
 * whatever screen renders next — GameStage/Board always read the singleton, never a prop.
 */
export function useActiveContent(hash: string | null | undefined): ActiveContentStatus {
  const [status, setStatus] = useState<ActiveContentStatus>(() => (hash ? 'loading' : 'ready'));

  useEffect(() => {
    if (!hash) {
      // No hash to resolve (e.g. a snapshot fixture that omits it): render with whatever
      // catalog is already active rather than deadlocking on 'loading' forever.
      setStatus('ready');
      return;
    }
    const result = resolveContent(hash);
    if (!(result instanceof Promise)) {
      setActiveContent(result);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    let cancelled = false;
    result
      .then((content) => {
        if (cancelled) return;
        setActiveContent(content);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [hash]);

  // Registered once (empty deps): fires only on final unmount, not on every hash change.
  useEffect(() => () => resetToDefaultContent(), []);

  return status;
}
