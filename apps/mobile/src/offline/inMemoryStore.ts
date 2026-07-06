// Test/dev double for SqliteLocalGameStore — same port contract, plus failure injection.
import type {
  LocalGameStorePort,
  OfflineGameListEntry,
  OfflineGameSetup,
  StoredActionRow,
} from './types';

interface GameRec {
  setup: OfflineGameSetup;
  genesisDigest: string;
  status: 'LIVE' | 'COMPLETED';
  updatedAt: number;
}

export class InMemoryLocalGameStore implements LocalGameStorePort {
  readonly games = new Map<string, GameRec>();
  readonly rows = new Map<string, StoredActionRow[]>();
  /** Set true to simulate storage-full: appendAction throws, nothing is written. */
  failAppends = false;
  private clock = 0;

  async createGame(setup: OfflineGameSetup, genesisDigest: string): Promise<void> {
    this.games.set(setup.gameId, {
      setup,
      genesisDigest,
      status: 'LIVE',
      updatedAt: this.clock++,
    });
    this.rows.set(setup.gameId, []);
  }

  async appendAction(gameId: string, row: StoredActionRow): Promise<void> {
    if (this.failAppends) throw new Error('append failed (injected)');
    const rows = this.rows.get(gameId);
    if (!rows) throw new Error(`no such offline game: ${gameId}`);
    if (rows.some((r) => r.seq === row.seq)) throw new Error(`duplicate seq ${row.seq}`);
    rows.push(row);
    const g = this.games.get(gameId);
    if (g) g.updatedAt = this.clock++;
  }

  async markCompleted(gameId: string): Promise<void> {
    const g = this.games.get(gameId);
    if (g) g.status = 'COMPLETED';
  }

  async discardTail(gameId: string, fromSeq: number): Promise<void> {
    const rows = this.rows.get(gameId) ?? [];
    this.rows.set(
      gameId,
      rows.filter((r) => r.seq < fromSeq),
    );
  }

  async loadGame(
    gameId: string,
  ): Promise<{ setup: OfflineGameSetup; actions: StoredActionRow[] } | null> {
    const g = this.games.get(gameId);
    if (!g) return null;
    const actions = [...(this.rows.get(gameId) ?? [])].sort((a, b) => a.seq - b.seq);
    return { setup: g.setup, actions };
  }

  async listGames(): Promise<OfflineGameListEntry[]> {
    return [...this.games.entries()]
      .map(([gameId, g]) => ({
        gameId,
        mapId: g.setup.mapId,
        botCount: g.setup.bots.length,
        status: g.status,
        currentSeq: this.rows.get(gameId)?.length ?? 0,
        updatedAt: g.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteGame(gameId: string): Promise<void> {
    this.games.delete(gameId);
    this.rows.delete(gameId);
  }
}
