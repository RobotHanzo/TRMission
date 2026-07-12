import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';

export type DevicePlatform = 'ios' | 'android';

/**
 * One row per push-capable device install. The token IS the identity (_id): re-registering
 * a token under another account moves it — a device pushes to whoever is signed in on it.
 */
export interface DeviceDoc {
  _id: string; // the FCM registration token / APNs device token
  userId: string;
  platform: DevicePlatform;
  createdAt: Date;
  lastSeenAt: Date;
}

@Injectable()
export class DeviceRepo implements OnModuleInit {
  private readonly col: Collection<DeviceDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<DeviceDoc>('userDevices');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ userId: 1 });
  }

  async upsert(userId: string, platform: DevicePlatform, token: string): Promise<void> {
    const now = new Date();
    await this.col.updateOne(
      { _id: token },
      { $set: { userId, platform, lastSeenAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
  }

  /** Scoped to the owner so one account can't unregister another's device. */
  async removeForUser(userId: string, token: string): Promise<void> {
    await this.col.deleteOne({ _id: token, userId });
  }

  listForUsers(userIds: string[]): Promise<DeviceDoc[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.col.find({ userId: { $in: userIds } }).toArray();
  }

  /** Platform said the token is dead (FCM UNREGISTERED / APNs 410) — drop it. */
  async prune(token: string): Promise<void> {
    await this.col.deleteOne({ _id: token });
  }

  /** Account deletion cascade. */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.col.deleteMany({ userId });
  }
}
