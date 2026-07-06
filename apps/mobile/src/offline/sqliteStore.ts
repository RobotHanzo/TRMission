// Event-sourced offline persistence on expo-sqlite — the on-device mirror of
// MongoGameStore (apps/server/src/persistence/game-store.ts): a setup row (genesis) plus
// one action row per accepted action carrying its stateDigest. The (game_id, seq) PRIMARY
// KEY is the durable double-apply guard (same role as the server's unique index). No
// snapshot table: offline logs are short and the engine replays them in well under a second.
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Action } from '@trm/engine';
import type {
  LocalGameStorePort,
  OfflineGameListEntry,
  OfflineGameSetup,
  StoredActionRow,
} from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS offline_games (
  game_id TEXT PRIMARY KEY NOT NULL,
  map_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'LIVE',
  setup_json TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  genesis_digest TEXT NOT NULL,
  current_seq INTEGER NOT NULL DEFAULT 0,
  bot_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS offline_actions (
  game_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  action_json TEXT NOT NULL,
  state_digest TEXT NOT NULL,
  PRIMARY KEY (game_id, seq)
);
`;

interface GameRow {
  setup_json: string;
  status: string;
}
interface ActionRow {
  seq: number;
  action_json: string;
  state_digest: string;
}
interface ListRow {
  game_id: string;
  map_id: string;
  status: string;
  current_seq: number;
  bot_count: number;
  updated_at: number;
}

export class SqliteLocalGameStore implements LocalGameStorePort {
  private constructor(private readonly db: SQLiteDatabase) {}

  static async open(name = 'trm-offline.db'): Promise<SqliteLocalGameStore> {
    const db = await SQLite.openDatabaseAsync(name);
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync(SCHEMA);
    return new SqliteLocalGameStore(db);
  }

  async createGame(setup: OfflineGameSetup, genesisDigest: string): Promise<void> {
    const now = Date.now();
    await this.db.runAsync(
      `INSERT INTO offline_games
         (game_id, map_id, status, setup_json, engine_version, content_hash,
          genesis_digest, current_seq, bot_count, created_at, updated_at)
       VALUES (?, ?, 'LIVE', ?, ?, ?, ?, 0, ?, ?, ?)`,
      setup.gameId,
      setup.mapId,
      JSON.stringify(setup),
      String(setup.engineVersion),
      setup.config.contentHash,
      genesisDigest,
      setup.bots.length,
      now,
      now,
    );
  }

  async appendAction(gameId: string, row: StoredActionRow): Promise<void> {
    // Both writes or neither: the log row and the list metadata move together.
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO offline_actions (game_id, seq, action_json, state_digest)
         VALUES (?, ?, ?, ?)`,
        gameId,
        row.seq,
        JSON.stringify(row.action),
        row.stateDigest,
      );
      await this.db.runAsync(
        `UPDATE offline_games SET current_seq = ?, updated_at = ? WHERE game_id = ?`,
        row.seq,
        Date.now(),
        gameId,
      );
    });
  }

  async markCompleted(gameId: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE offline_games SET status = 'COMPLETED', updated_at = ? WHERE game_id = ?`,
      Date.now(),
      gameId,
    );
  }

  async discardTail(gameId: string, fromSeq: number): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `DELETE FROM offline_actions WHERE game_id = ? AND seq >= ?`,
        gameId,
        fromSeq,
      );
      await this.db.runAsync(
        `UPDATE offline_games SET current_seq = ?, updated_at = ? WHERE game_id = ?`,
        fromSeq - 1,
        Date.now(),
        gameId,
      );
    });
  }

  async loadGame(
    gameId: string,
  ): Promise<{ setup: OfflineGameSetup; actions: StoredActionRow[] } | null> {
    const game = await this.db.getFirstAsync<GameRow>(
      `SELECT setup_json, status FROM offline_games WHERE game_id = ?`,
      gameId,
    );
    if (!game) return null;
    const rows = await this.db.getAllAsync<ActionRow>(
      `SELECT seq, action_json, state_digest FROM offline_actions
       WHERE game_id = ? ORDER BY seq ASC`,
      gameId,
    );
    return {
      setup: JSON.parse(game.setup_json) as OfflineGameSetup,
      actions: rows.map((r) => ({
        seq: r.seq,
        action: JSON.parse(r.action_json) as Action,
        stateDigest: r.state_digest,
      })),
    };
  }

  async listGames(): Promise<OfflineGameListEntry[]> {
    const rows = await this.db.getAllAsync<ListRow>(
      `SELECT game_id, map_id, status, current_seq, bot_count, updated_at
       FROM offline_games ORDER BY updated_at DESC`,
    );
    return rows.map((r) => ({
      gameId: r.game_id,
      mapId: r.map_id,
      status: r.status === 'COMPLETED' ? 'COMPLETED' : 'LIVE',
      currentSeq: r.current_seq,
      botCount: r.bot_count,
      updatedAt: r.updated_at,
    }));
  }

  async deleteGame(gameId: string): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM offline_actions WHERE game_id = ?`, gameId);
      await this.db.runAsync(`DELETE FROM offline_games WHERE game_id = ?`, gameId);
    });
  }
}
