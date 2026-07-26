// The platform's default offline store: the event-sourced expo-sqlite log on device.
// (localStore.web.ts swaps in an in-memory store for the desktop web harness.)
//
// **Exactly one handle per process, memoized** — opening the database more than once corrupts it
// from under you. expo-sqlite gives every `openDatabaseAsync` of the same file its own JS handle
// over ONE ref-counted native database, but that native object's `sharedObjectDidRelease` closes
// the sqlite pointer without consulting the ref count. So the moment any short-lived JS handle is
// garbage-collected, every other live handle's next call lands on a null pointer
// (`NativeDatabase.execAsync ... has been rejected` / `java.lang.NullPointerException`). Callers
// open freely — Home remounts its resume list on every focus — so the only safe number is one.
import { SqliteLocalGameStore } from './sqliteStore';
import type { LocalGameStorePort } from './types';

let opening: Promise<LocalGameStorePort> | null = null;

export const openLocalGameStore = (): Promise<LocalGameStorePort> => {
  if (!opening) {
    opening = SqliteLocalGameStore.open();
    // A failed open is not memoized: the next caller retries from scratch rather than inheriting
    // a permanently rejected promise for the life of the process.
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
};
