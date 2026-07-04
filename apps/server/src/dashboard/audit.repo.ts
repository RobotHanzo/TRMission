import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ObjectId, type Collection, type Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';

export type DashboardAuditAction =
  | 'bootstrap.grant'
  | 'user.ban'
  | 'user.unban'
  | 'user.features'
  | 'game.terminate'
  | 'room.close'
  | 'maintainer.grant'
  | 'maintainer.update'
  | 'maintainer.revoke';

export interface AuditTarget {
  type: 'user' | 'game' | 'room' | 'maintainer';
  id: string;
}

export interface AuditEntryDoc {
  /** Default ObjectId: time-ordered, so it doubles as the pagination cursor. */
  _id: ObjectId;
  actorId: string;
  /** Denormalized — user docs can TTL-expire; the log must stay self-contained. */
  actorName: string;
  action: DashboardAuditAction;
  target?: AuditTarget;
  params?: Record<string, unknown>;
  at: Date;
}

/**
 * Append-only log of every mutating dashboard action. Enforced by surface: this repo
 * exposes only `append` and `list` — no update or delete methods exist (a spec pins this).
 */
@Injectable()
export class DashboardAuditRepo implements OnModuleInit {
  private readonly col: Collection<AuditEntryDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<AuditEntryDoc>('dashboardAudit');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ at: -1 });
  }

  async append(entry: Omit<AuditEntryDoc, '_id' | 'at'>): Promise<AuditEntryDoc> {
    const doc: AuditEntryDoc = { _id: new ObjectId(), at: new Date(), ...entry };
    await this.col.insertOne(doc);
    return doc;
  }

  /** Reverse-chronological page; `cursor` is the `_id` of the last entry of the prior page. */
  async list(limit: number, cursor?: string): Promise<AuditEntryDoc[]> {
    const filter = cursor ? { _id: { $lt: new ObjectId(cursor) } } : {};
    return this.col.find(filter).sort({ _id: -1 }).limit(limit).toArray();
  }

  /** Test/bootstrap helper: how many entries exist for one action (cheap, unindexed is fine). */
  countByAction(action: DashboardAuditAction): Promise<number> {
    return this.col.countDocuments({ action });
  }
}
