// The regression guard for TRMISSION-MOBILE-1: a second `openDatabaseAsync` of the same file
// leaves two JS handles over one ref-counted native database, and expo-sqlite closes that native
// pointer as soon as either handle is garbage-collected — so the survivor's next statement dies on
// `java.lang.NullPointerException`. Callers open freely, so the memoization here is the only thing
// keeping the handle count at one.
import type * as LocalStoreModule from './localStore';
import type * as SqliteStoreModule from './sqliteStore';
import type { LocalGameStorePort } from './types';

jest.mock('./sqliteStore', () => ({ SqliteLocalGameStore: { open: jest.fn() } }));

/** Fresh module registry per test — the memo this guards lives in module scope. */
function load() {
  let sqlite!: typeof SqliteStoreModule;
  let store!: typeof LocalStoreModule;
  jest.isolateModules(() => {
    // isolateModules needs non-hoisted requires so ./localStore re-runs with an empty memo.
    /* eslint-disable @typescript-eslint/no-require-imports */
    sqlite = require('./sqliteStore');
    store = require('./localStore');
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  return {
    open: sqlite.SqliteLocalGameStore.open as unknown as jest.Mock,
    openLocalGameStore: store.openLocalGameStore,
  };
}

const fakeStore = () => ({}) as unknown as LocalGameStorePort;

describe('openLocalGameStore', () => {
  it('opens the database once, however many callers ask', async () => {
    const { open, openLocalGameStore } = load();
    open.mockResolvedValue(fakeStore());

    // Concurrent (Home's resume list + a game screen mounting) and sequential (a later focus).
    const [a, b] = await Promise.all([openLocalGameStore(), openLocalGameStore()]);
    const c = await openLocalGameStore();

    expect(open).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('does not memoize a failed open — the next caller retries', async () => {
    const { open, openLocalGameStore } = load();
    const store = fakeStore();
    open.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(store);

    await expect(openLocalGameStore()).rejects.toThrow('disk full');
    await expect(openLocalGameStore()).resolves.toBe(store);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
