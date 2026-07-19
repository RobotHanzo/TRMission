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
    await this.col.createIndex({ userId: 1, createdAt: -1 });
    await this.col.createIndex({ createdAt: -1 });
  }

  async insert(
    userId: string,
    gameId: string,
    roomId: string,
    stars: number,
    text?: string,
  ): Promise<GameRatingDoc> {
    const doc: GameRatingDoc = {
      _id: randomUUID(),
      userId,
      gameId,
      roomId,
      stars,
      ...(text ? { text } : {}),
      createdAt: new Date(),
    };
    await this.col.insertOne(doc);
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
