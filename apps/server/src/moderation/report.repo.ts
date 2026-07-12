import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ObjectId, type Collection, type Db, type Filter } from 'mongodb';
import type { ReportCategory } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';

export type ReportKind = 'player' | 'map';
export type ReportStatus = 'open' | 'resolved';

/**
 * A UGC abuse report (Apple 1.2 / Play UGC). Names are denormalized — reporters and
 * targets can be TTL-expired guests or deleted accounts, and the record must stay
 * self-contained (same posture as dashboardAudit.actorName). Context ids are opaque
 * display hints for moderators, never authorization inputs.
 */
export interface ReportDoc {
  /** Default ObjectId: time-ordered, so it doubles as the pagination cursor. */
  _id: ObjectId;
  kind: ReportKind;
  status: ReportStatus;
  category: ReportCategory;
  message?: string;
  reporterId: string;
  reporterName: string;
  // kind: 'player'
  reportedUserId?: string;
  reportedName?: string;
  gameId?: string;
  roomCode?: string;
  // kind: 'map'
  mapId?: string;
  mapOwnerId?: string;
  shareCode?: string;
  mapNameZh?: string;
  mapNameEn?: string;
  // resolution
  resolvedBy?: string;
  resolvedByName?: string;
  resolutionNote?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

@Injectable()
export class ReportRepo implements OnModuleInit {
  private readonly col: Collection<ReportDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<ReportDoc>('reports');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ status: 1, _id: -1 });
  }

  async create(entry: Omit<ReportDoc, '_id' | 'status' | 'createdAt'>): Promise<ReportDoc> {
    const doc: ReportDoc = { _id: new ObjectId(), status: 'open', createdAt: new Date(), ...entry };
    await this.col.insertOne(doc);
    return doc;
  }

  /** Reverse-chronological page; `cursor` is the `_id` of the prior page's last entry. */
  async list(status: ReportStatus | 'all', limit: number, cursor?: string): Promise<ReportDoc[]> {
    const filter: Filter<ReportDoc> = {};
    if (status !== 'all') filter.status = status;
    if (cursor) {
      try {
        filter._id = { $lt: new ObjectId(cursor) };
      } catch {
        /* malformed cursor → first page (cursors are a convenience, not state) */
      }
    }
    return this.col.find(filter).sort({ _id: -1 }).limit(limit).toArray();
  }

  /** open → resolved CAS; null when missing, malformed, or already resolved. */
  async resolve(
    id: string,
    actorId: string,
    actorName: string,
    note?: string,
  ): Promise<ReportDoc | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      return null;
    }
    return this.col.findOneAndUpdate(
      { _id: oid, status: 'open' },
      {
        $set: {
          status: 'resolved' as const,
          resolvedBy: actorId,
          resolvedByName: actorName,
          resolvedAt: new Date(),
          ...(note ? { resolutionNote: note } : {}),
        },
      },
      { returnDocument: 'after' },
    );
  }
}
