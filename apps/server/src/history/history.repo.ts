import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { boardForContentHash } from '@trm/engine';
import type { Action } from '@trm/engine';
import { MONGO_DB } from '../db/tokens';
import type {
  GameDoc,
  GameEventDoc,
  MatchHistoryDoc,
  ReplayVisibility,
  StoredConfig,
} from '../persistence/types';
import type { UserDoc } from '../auth/user.repo';
import type { BotProfile } from '../bots/types';
import type { MapContentDoc } from '../maps/maps.types';

export interface HistoryPlayer {
  userId: string;
  seat: number;
  displayName?: string;
}

export interface MatchSummary {
  gameId: string;
  players: HistoryPlayer[];
  winners: string[];
  completedAt: string;
  role: 'player' | 'spectator';
  finalScores: MatchHistoryDoc['finalScores'];
  replayable: boolean;
}

export interface ReplayData {
  config: StoredConfig;
  engineVersion: number;
  schemaVersion: number;
  bots: BotProfile[];
  actions: Action[];
  finalDigest?: string;
}

/**
 * Engine major versions whose persisted action logs the current server can still replay
 * byte-identically. v5 replayed a v4 log identically (v5 only added inert genesis fields), but v6
 * is NOT provably inert for v4/v5 games: it changes turn sequencing for any `unlimitedStationBorrow`
 * game where a player's kept tickets completed via station-borrow only (not own track) — a replay
 * of such a game would now diverge into a forced ticket re-draw a turn earlier than it actually
 * happened, breaking the next logged action's phase expectation. So v6 stands alone rather than
 * extending the allowlist. Only extend this list for a new version when the change is provably
 * inert for the versions already listed.
 */
export const REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] = [6];

@Injectable()
export class HistoryRepo {
  private readonly col: Collection<MatchHistoryDoc>;
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly users: Collection<UserDoc>;
  private readonly mapContents: Collection<MapContentDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<MatchHistoryDoc>('matchHistory');
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.users = db.collection<UserDoc>('users');
    this.mapContents = db.collection<MapContentDoc>('mapContents');
  }

  /**
   * Replayable = a replay-compatible engine major + a board we can still build for that content
   * hash. The static registry (official maps) resolves synchronously; a custom-map hash falls back
   * to a single batched `mapContents` lookup so listing N rows costs at most one extra query, not N.
   */
  private async replayableFlags(
    rows: { contentHash: string; engineVersion: number | undefined }[],
  ): Promise<boolean[]> {
    const staticFlags: (boolean | undefined)[] = rows.map((r) => {
      if (r.engineVersion === undefined || !REPLAY_COMPATIBLE_ENGINE_VERSIONS.includes(r.engineVersion))
        return false;
      try {
        boardForContentHash(r.contentHash);
        return true;
      } catch {
        return undefined; // not in the static registry — check mapContents below
      }
    });
    const unresolved = [
      ...new Set(rows.filter((_, i) => staticFlags[i] === undefined).map((r) => r.contentHash)),
    ];
    let known = new Set<string>();
    if (unresolved.length > 0) {
      const docs = await this.mapContents
        .find({ _id: { $in: unresolved } }, { projection: { _id: 1 } })
        .toArray();
      known = new Set(docs.map((d) => d._id));
    }
    return rows.map((r, i) => staticFlags[i] ?? known.has(r.contentHash));
  }

  /** Display names for userIds (bots and TTL-expired guests simply don't match). */
  async displayNames(userIds: string[]): Promise<Map<string, string>> {
    const humans = [...new Set(userIds)].filter((id) => !id.startsWith('bot:'));
    if (humans.length === 0) return new Map();
    const docs = await this.users
      .find({ _id: { $in: humans } }, { projection: { displayName: 1 } })
      .toArray();
    return new Map(docs.map((u) => [u._id, u.displayName]));
  }

  /** Finished games the user played in or spectated, newest first. */
  async listForUser(userId: string, limit = 50): Promise<MatchSummary[]> {
    const docs = await this.col
      .find({ $or: [{ 'players.userId': userId }, { spectators: userId }] })
      .sort({ completedAt: -1 })
      .limit(limit)
      .toArray();

    // Legacy archives predate the engineVersion stamp — read it off the game doc instead.
    const missing = docs.filter((d) => d.engineVersion === undefined).map((d) => d._id);
    const versions = new Map<string, number>();
    if (missing.length > 0) {
      const games = await this.games
        .find({ _id: { $in: missing } }, { projection: { engineVersion: 1 } })
        .toArray();
      for (const g of games) versions.set(g._id, g.engineVersion);
    }
    const names = await this.displayNames(docs.flatMap((d) => d.players.map((p) => p.userId)));
    const flags = await this.replayableFlags(
      docs.map((d) => ({
        contentHash: d.contentHash,
        engineVersion: d.engineVersion ?? versions.get(d._id),
      })),
    );

    return docs.map((d, i) => ({
      gameId: d._id,
      players: d.players.map((p) => {
        const displayName = names.get(p.userId);
        return {
          userId: p.userId,
          seat: p.seat,
          ...(displayName !== undefined ? { displayName } : {}),
        };
      }),
      winners: d.winners,
      completedAt: d.completedAt.toISOString(),
      role: d.players.some((p) => p.userId === userId)
        ? ('player' as const)
        : ('spectator' as const),
      finalScores: d.finalScores,
      replayable: flags[i] ?? false,
    }));
  }

  /** The archive doc IF the user played or spectated it; null otherwise (→ 404 upstream). */
  getForUser(gameId: string, userId: string): Promise<MatchHistoryDoc | null> {
    return this.col.findOne({
      _id: gameId,
      $or: [{ 'players.userId': userId }, { spectators: userId }],
    });
  }

  /** The archive doc with no membership filter — the caller decides access (replay visibility). */
  get(gameId: string): Promise<MatchHistoryDoc | null> {
    return this.col.findOne({ _id: gameId });
  }

  /**
   * Flip a replay between private and view-by-link. The filter carries the authorization:
   * only a SEATED player of that game matches (spectators/outsiders → no match → 404 upstream).
   */
  async setVisibility(
    gameId: string,
    userId: string,
    visibility: ReplayVisibility,
  ): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: gameId, 'players.userId': userId },
      { $set: { replayVisibility: visibility } },
    );
    return res.matchedCount > 0;
  }

  /**
   * Full replay payload: stored config + the ordered action log. `status: 'COMPLETED'` is the
   * hard gate — a LIVE game's action log encodes hidden information (payments, kept tickets,
   * deck order via the seed) and must never leave the server. Shipping a FINISHED game's log
   * to an authorized participant/spectator is by design (see docs: replay feature).
   */
  async loadReplay(gameId: string): Promise<ReplayData | null> {
    const game = await this.games.findOne({ _id: gameId, status: 'COMPLETED' });
    if (!game) return null;
    const events = await this.events.find({ gameId }).sort({ seq: 1 }).toArray();
    const last = events[events.length - 1];
    return {
      config: game.config,
      engineVersion: game.engineVersion,
      schemaVersion: game.schemaVersion,
      bots: game.bots ?? [],
      actions: events.map((e) => e.action),
      ...(last ? { finalDigest: last.stateDigest } : {}),
    };
  }
}
