import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import type { MatchHistoryDoc } from '../persistence/types';

@Injectable()
export class HistoryRepo {
  private readonly col: Collection<MatchHistoryDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<MatchHistoryDoc>('matchHistory');
  }

  listForUser(userId: string, limit = 20): Promise<MatchHistoryDoc[]> {
    return this.col
      .find({ 'players.userId': userId })
      .sort({ completedAt: -1 })
      .limit(limit)
      .toArray();
  }

  get(gameId: string): Promise<MatchHistoryDoc | null> {
    return this.col.findOne({ _id: gameId });
  }
}
