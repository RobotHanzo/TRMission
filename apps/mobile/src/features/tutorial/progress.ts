// Tutorial completion, persisted on-device (AsyncStorage). Fully offline; storage failures are
// swallowed — a completion badge is a convenience and must never block or crash the tutorial.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Scope } from './types';

const KEY = 'trm.tutorial.completed.v1';

export interface TutorialCompletion {
  scope: Scope;
  completedAt: string; // ISO-8601
}

// Reachable with no account (pre-login), so the key falls back to a shared, unnamespaced bucket
// when there's no signed-in user. Once an account exists, its completion is tracked under its own
// id — otherwise a device that already finished the tutorial under one account (or pre-login)
// would silently mark it done for every OTHER account that later signs in on the same device.
function storageKey(userId?: string): string {
  return userId ? `${KEY}:${userId}` : KEY;
}

export async function getTutorialCompletion(userId?: string): Promise<TutorialCompletion | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TutorialCompletion>;
    return (parsed.scope === 'core' || parsed.scope === 'full') &&
      typeof parsed.completedAt === 'string'
      ? { scope: parsed.scope, completedAt: parsed.completedAt }
      : null;
  } catch {
    return null;
  }
}

export async function markTutorialCompleted(scope: Scope, userId?: string): Promise<void> {
  try {
    await AsyncStorage.setItem(
      storageKey(userId),
      JSON.stringify({ scope, completedAt: new Date().toISOString() } satisfies TutorialCompletion),
    );
  } catch {
    /* storage unavailable/full — keep the finale on screen regardless */
  }
}
