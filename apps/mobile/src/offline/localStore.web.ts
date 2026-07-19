// Web-harness variant: expo-sqlite's wasm build isn't wired into the web bundle, so offline
// games persist in-memory for the tab's lifetime — one shared instance, so the Home resume list
// and a running game see the same store. Enough for Playwright flows; a reload loses saves
// (native persistence is covered by the sqlite store's own tests).
import { InMemoryLocalGameStore } from './inMemoryStore';
import type { LocalGameStorePort } from './types';

let singleton: InMemoryLocalGameStore | null = null;

export const openLocalGameStore = async (): Promise<LocalGameStorePort> =>
  (singleton ??= new InMemoryLocalGameStore());
