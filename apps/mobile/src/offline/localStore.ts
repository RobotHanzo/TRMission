// The platform's default offline store: the event-sourced expo-sqlite log on device.
// (localStore.web.ts swaps in an in-memory store for the desktop web harness.)
import { SqliteLocalGameStore } from './sqliteStore';
import type { LocalGameStorePort } from './types';

export const openLocalGameStore = (): Promise<LocalGameStorePort> => SqliteLocalGameStore.open();
