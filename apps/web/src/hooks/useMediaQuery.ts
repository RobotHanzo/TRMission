import { useEffect, useState } from 'react';

/** The phone tier. CSS twins live in each feature's stylesheet as
 *  `@media (max-width: 700px)` blocks — keep them in sync with this value. */
export const PHONE_QUERY = '(max-width: 700px)';

/** Reactive matchMedia. Returns false where matchMedia is unavailable (jsdom/SSR). */
export function useMediaQuery(query: string): boolean {
  const read = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
