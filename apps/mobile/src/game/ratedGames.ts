// Per-game rating dedupe (the web keeps the same set in localStorage under the same key):
// once a game is rated, its scoreboard never re-asks. Storage failures are swallowed — the
// worst case is being asked again, never a crash.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'trm.ratedGameIds';

async function getRatedGameIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export async function hasRatedGame(gameId: string): Promise<boolean> {
  return (await getRatedGameIds()).has(gameId);
}

export async function markGameRated(gameId: string): Promise<void> {
  try {
    const ids = await getRatedGameIds();
    ids.add(gameId);
    await AsyncStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable */
  }
}
