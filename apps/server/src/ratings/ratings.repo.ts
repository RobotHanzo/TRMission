import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import type { GameRatingDoc } from './ratings.types';

@Injectable()
export class RatingsRepo implements OnModuleInit {
  private readonly col: Collection<GameRatingDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<GameRatingDoc>('gameRatings');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ gameId: 1 });
    // One rating per user per game — `upsert` below updates the existing row on a
    // resubmission instead of inserting a duplicate.
    await this.col.createIndex({ userId: 1, gameId: 1 }, { unique: true });
    await this.col.createIndex({ userId: 1, createdAt: -1 });
    await this.col.createIndex({ createdAt: -1 });
  }

  /**
   * One rating per {userId, gameId}: a resubmission (there's no "edit my rating" UI, but a
   * retried/repeated POST from the same user for the same game is otherwise indistinguishable
   * from an edit) updates the existing row's stars/text/roomId in place rather than inserting
   * a duplicate — the unique index above makes that the only possible outcome, and keeping the
   * endpoint idempotent avoids surfacing a spurious 409 to a legitimate retry. `createdAt` is
   * preserved from the first submission via $setOnInsert.
   */
  async upsert(
    userId: string,
    gameId: string,
    roomId: string,
    stars: number,
    text?: string,
  ): Promise<GameRatingDoc> {
    const set: Record<string, unknown> = { roomId, stars };
    const unset: Record<string, ''> = {};
    if (text) set.text = text;
    else unset.text = '';
    const doc = await this.col.findOneAndUpdate(
      { userId, gameId },
      {
        $set: set,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        $setOnInsert: { _id: randomUUID(), createdAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new Error('upsert returned no document');
    return doc;
  }

  /** Admin listing: newest first, cursor-paginated. */
  listPage(cursor: { t: Date; id: string } | null, limit: number): Promise<GameRatingDoc[]> {
    const filter = cursor
      ? {
          $or: [{ createdAt: { $lt: cursor.t } }, { createdAt: cursor.t, _id: { $lt: cursor.id } }],
        }
      : {};
    return this.col.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray();
  }

  async summary(): Promise<{ avgStars: number | null; totalCount: number }> {
    const [agg] = await this.col
      .aggregate<{
        _id: null;
        avg: number;
        count: number;
      }>([{ $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } }])
      .toArray();
    return { avgStars: agg ? agg.avg : null, totalCount: agg ? agg.count : 0 };
  }

  /** Account-deletion cascade — drops every rating a deleted user submitted. */
  async deleteByUser(userId: string): Promise<number> {
    const res = await this.col.deleteMany({ userId });
    return res.deletedCount;
  }
}
