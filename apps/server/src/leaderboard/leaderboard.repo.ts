import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Collection, Db, Filter } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import type { LeaderboardMetric, LeaderboardClaimDoc, PlayerStatsDoc } from './leaderboard.types';
import { type RankCursor } from './rank-cursor';

const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

@Injectable()
export class LeaderboardRepo implements OnModuleInit {
  private readonly stats: Collection<PlayerStatsDoc>;
  private readonly claims: Collection<LeaderboardClaimDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.stats = db.collection<PlayerStatsDoc>('playerLeaderboardStats');
    this.claims = db.collection<LeaderboardClaimDoc>('leaderboardClaims');
  }

  async onModuleInit(): Promise<void> {
    await this.stats.createIndex({ scope: 1, rating: -1 });
    await this.stats.createIndex({ scope: 1, wins: -1 });
    await this.stats.createIndex({ scope: 1, gamesPlayed: -1 });
    await this.stats.createIndex({ userId: 1 });
  }

  /** True the first time this gameId is claimed; false if already processed (or racing). */
  async tryClaim(gameId: string): Promise<boolean> {
    try {
      await this.claims.insertOne({ _id: gameId, claimedAt: new Date() });
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  getOne(id: string): Promise<PlayerStatsDoc | null> {
    return this.stats.findOne({ _id: id });
  }

  /** Optimistic-concurrency write: succeeds only if the doc's version still matches what the
   *  caller last read (undefined = doc must not exist yet). Returns false on conflict — the
   *  caller re-reads and retries with a freshly-derived `next`. */
  async casWrite(
    id: string,
    userId: string,
    scope: string,
    expectedVersion: number | undefined,
    next: { rating: number; gamesPlayed: number; wins: number; losses: number },
  ): Promise<boolean> {
    const updatedAt = new Date();
    if (expectedVersion === undefined) {
      try {
        await this.stats.insertOne({ _id: id, userId, scope, ...next, version: 1, updatedAt });
        return true;
      } catch (err) {
        if (isDuplicateKeyError(err)) return false;
        throw err;
      }
    }
    const res = await this.stats.updateOne(
      { _id: id, version: expectedVersion },
      { $set: { ...next, updatedAt }, $inc: { version: 1 } },
    );
    return res.matchedCount === 1;
  }

  /** Top-N page for one scope+metric, newest-tiebroken by _id (userId:scope, stable enough). */
  top(
    scope: string,
    metric: LeaderboardMetric,
    cursor: RankCursor | null,
    limit: number,
  ): Promise<PlayerStatsDoc[]> {
    const filter: Filter<PlayerStatsDoc> = { scope };
    if (cursor) {
      filter.$or = [
        { [metric]: { $lt: cursor.v } },
        { [metric]: cursor.v, _id: { $lt: cursor.id } },
      ];
    }
    return this.stats
      .find(filter)
      .sort({ [metric]: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Count of docs in this scope whose metric value beats `value` — competition ranking (ties
   *  share a rank; the next distinct value skips to its true position, never rank+1). */
  countAbove(scope: string, metric: LeaderboardMetric, value: number): Promise<number> {
    return this.stats.countDocuments({ scope, [metric]: { $gt: value } });
  }

  /** The caller's own row + rank in one scope+metric, even when off the visible page. */
  async standing(
    userId: string,
    scope: string,
    metric: LeaderboardMetric,
  ): Promise<{ doc: PlayerStatsDoc; rank: number } | null> {
    const doc = await this.stats.findOne({ _id: `${userId}:${scope}` });
    if (!doc) return null;
    const rank = (await this.countAbove(scope, metric, doc[metric])) + 1;
    return { doc, rank };
  }

  /** Account-deletion cascade — drops every scope row a deleted user accumulated. */
  async deleteByUser(userId: string): Promise<void> {
    await this.stats.deleteMany({ userId });
  }
}
