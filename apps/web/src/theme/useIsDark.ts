// Is the app rendering dark right now? `App.tsx` stamps data-theme on <html> for the CSS tokens,
// but a component that has to pick colours in JS — the train-car night livery — needs the same
// answer reactively. The resolution RULE lives in @trm/client-core so this and mobile's
// useTheme() cannot drift; only the way the OS preference is read is per-platform (matchMedia
// here, useColorScheme on native).
import { useEffect, useState } from 'react';
import { isDarkTheme } from '@trm/client-core/theme/tokens';
import { useUi } from '../store/ui';

const QUERY = '(prefers-color-scheme: dark)';

export function useIsDark(): boolean {
  const pref = useUi((s) => s.theme);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const apply = (): void => setSystemDark(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return isDarkTheme(pref, systemDark);
}
