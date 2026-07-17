// On-device mirror of the account's seen map-feature intros (PublicUser.seenFeatureIntros), so a
// failed server write — or a future offline game with no session — still remembers what was shown.
// The union of this list and the account list decides whether an intro appears. Storage failures
// are swallowed (same posture as progress.ts): the intro is a convenience, never a blocker.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'trm.featureIntro.seen.v1';

export async function getSeenFeatureIntros(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function addSeenFeatureIntro(feature: string): Promise<void> {
  try {
    const cur = await getSeenFeatureIntros();
    if (!cur.includes(feature)) await AsyncStorage.setItem(KEY, JSON.stringify([...cur, feature]));
  } catch {
    /* storage unavailable — the intro may show once more; never block the game */
  }
}
