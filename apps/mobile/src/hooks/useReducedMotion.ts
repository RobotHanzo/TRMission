import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Tracks the OS "reduce motion" preference (ports the web hook's matchMedia onto RN's
 *  AccessibilityInfo); camera glides and cues degrade to instant when true. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduced(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
