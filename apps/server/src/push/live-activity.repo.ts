import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';

/**
 * One row per LIVE iOS Live Activity (issue #43): the ActivityKit push token that lets the server
 * keep a suspended app's Dynamic Island current. Like `userDevices` the token IS the identity, but
 * unlike a device token it belongs to ONE activity for ONE game and is short-lived — ActivityKit
 * mints a fresh one per activity and ends the activity itself after at most ~12h, which is exactly
 * what the TTL index below mirrors so a row can never outlive the card it updates.
 */
export interface LiveActivityDoc {
  _id: string; // the ActivityKit push token (hex)
  userId: string;
  gameId: string;
  createdAt: Date;
  lastSeenAt: Date;
}

/** ActivityKit's own ceiling for an activity's lifetime; a row past this can only be stale. */
const TTL_SECONDS = 12 * 60 * 60;

@Injectable()
export class LiveActivityRepo implements OnModuleInit {
  private readonly col: Collection<LiveActivityDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<LiveActivityDoc>('liveActivities');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ gameId: 1 });
    await this.col.createIndex({ userId: 1 });
    await this.col.createIndex({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS });
  }

  /** Re-registering a token moves it to the current game/account (a device plays one game at a time). */
  async upsert(userId: string, gameId: string, token: string): Promise<void> {
    const now = new Date();
    await this.col.updateOne(
      { _id: token },
      { $set: { userId, gameId, lastSeenAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
  }

  /** Scoped to the owner so one account can't unregister another's activity. */
  async removeForUser(userId: string, token: string): Promise<void> {
    await this.col.deleteOne({ _id: token, userId });
  }

  listForGame(gameId: string): Promise<LiveActivityDoc[]> {
    return this.col.find({ gameId }).toArray();
  }

  /** APNs said the token is dead (410 / BadDeviceToken), or the activity was ended. */
  async prune(token: string): Promise<void> {
    await this.col.deleteOne({ _id: token });
  }

  /** The game is over — every activity for it has just been ended. */
  async deleteForGame(gameId: string): Promise<void> {
    await this.col.deleteMany({ gameId });
  }

  /** Account deletion cascade. */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.col.deleteMany({ userId });
  }
}
