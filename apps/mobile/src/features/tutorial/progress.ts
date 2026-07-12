// Tutorial completion, persisted on-device (AsyncStorage). Fully offline; storage failures are
// swallowed — a completion badge is a convenience and must never block or crash the tutorial.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Scope } from './types';

const KEY = 'trm.tutorial.completed.v1';

export interface TutorialCompletion {
  scope: Scope;
  completedAt: string; // ISO-8601
}

export async function getTutorialCompletion(): Promise<TutorialCompletion | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
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

export async function markTutorialCompleted(scope: Scope): Promise<void> {
  try {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ scope, completedAt: new Date().toISOString() } satisfies TutorialCompletion),
    );
  } catch {
    /* storage unavailable/full — keep the finale on screen regardless */
  }
}
