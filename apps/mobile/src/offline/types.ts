// Offline (vs bots) domain types. Everything in this module tree except seed.ts and
// sqliteStore.ts is pure TS — no React Native imports — so the core is testable off-device.
import type { BotProfile } from '@trm/bots';
import type { Action, GameConfig } from '@trm/engine';

/** The local human's engine PlayerId. Never a bot: no 'bot:' prefix (UI bot badges key off it). */
export const LOCAL_HUMAN_ID = 'local:human';

/** Identity + rules of one offline game (serialized whole into the store's setup column). */
export interface OfflineGameSetup {
  readonly gameId: string;
  /** seed + players + ruleParams + contentHash — the same GameConfig shape the server persists. */
  readonly config: GameConfig;
  readonly bots: readonly BotProfile[];
  /** Official map id (v1 offline is bundled-official-maps only). */
  readonly mapId: string;
  /** Version pin (mirror of the server's stamped engineVersion, a number): resume refuses a mismatch. */
  readonly engineVersion: number;
}

/** One persisted action row — the sqlite mirror of the server's gameEvents doc. */
export interface StoredActionRow {
  readonly seq: number;
  readonly action: Action;
  readonly stateDigest: string;
}

/** Home-screen resume list entry. */
export interface OfflineGameListEntry {
  readonly gameId: string;
  readonly mapId: string;
  readonly botCount: number;
  readonly status: 'LIVE' | 'COMPLETED';
  readonly currentSeq: number;
  readonly updatedAt: number; // epoch ms
}

/**
 * Persistence port. `SqliteLocalGameStore` implements it on-device;
 * `InMemoryLocalGameStore` in tests. Contract notes:
 *  - appendAction MUST reject a duplicate (gameId, seq) — the double-apply guard.
 *  - discardTail deletes every row with seq >= fromSeq (corrupt-tail recovery).
 *  - loadGame returns actions ordered by seq ascending.
 */
export interface LocalGameStorePort {
  createGame(setup: OfflineGameSetup, genesisDigest: string): Promise<void>;
  appendAction(gameId: string, row: StoredActionRow): Promise<void>;
  markCompleted(gameId: string): Promise<void>;
  discardTail(gameId: string, fromSeq: number): Promise<void>;
  loadGame(gameId: string): Promise<{ setup: OfflineGameSetup; actions: StoredActionRow[] } | null>;
  listGames(): Promise<OfflineGameListEntry[]>;
  deleteGame(gameId: string): Promise<void>;
}
