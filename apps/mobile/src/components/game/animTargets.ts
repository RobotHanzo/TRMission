// The flight-target registry: HUD components register their anchor views under stable keys
// (`deck`, `market-slot-{i}`, `player-{id}`) so the Task 10 animation driver can measure where a
// card flight starts/ends without threading refs through the component tree.
import type { View } from 'react-native';

const targets = new Map<string, View>();

export const registerAnimTarget = (key: string, ref: View | null): void => {
  if (ref) targets.set(key, ref);
  else targets.delete(key);
};

export const measureAnimTarget = (
  key: string,
): Promise<{ x: number; y: number; w: number; h: number } | null> =>
  new Promise((resolve) => {
    const v = targets.get(key);
    if (!v) {
      resolve(null);
      return;
    }
    v.measureInWindow((x, y, w, h) => resolve({ x, y, w, h }));
  });
