import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { RatingsRepo } from '../ratings/ratings.repo';
import type { GameRatingDoc } from '../ratings/ratings.types';
import type { UserDoc } from '../auth/user.repo';
import { decodeCursor, encodeCursor } from './cursor';

const toRow = (r: GameRatingDoc, userDisplayName?: string) => ({
  id: r._id,
  userId: r.userId,
  ...(userDisplayName !== undefined ? { userDisplayName } : {}),
  gameId: r.gameId,
  roomId: r.roomId,
  stars: r.stars,
  createdAt: r.createdAt.toISOString(),
});

@Injectable()
export class DashboardRatingsService {
  private readonly users: Collection<UserDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly ratings: RatingsRepo,
  ) {
    this.users = db.collection<UserDoc>('users');
  }

  private async displayNames(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const docs = await this.users
      .find({ _id: { $in: ids } }, { projection: { displayName: 1 } })
      .toArray();
    return new Map(docs.map((u) => [u._id, u.displayName]));
  }

  async list(query: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(query.cursor);
    const [docs, summary] = await Promise.all([
      this.ratings.listPage(cursor, query.limit),
      this.ratings.summary(),
    ]);
    const names = await this.displayNames(docs.map((d) => d.userId));
    const last = docs.length === query.limit ? docs[docs.length - 1] : undefined;
    return {
      ratings: docs.map((d) => toRow(d, names.get(d.userId))),
      nextCursor: last ? encodeCursor(last.createdAt, last._id) : null,
      avgStars: summary.avgStars,
      totalCount: summary.totalCount,
    };
  }
}
