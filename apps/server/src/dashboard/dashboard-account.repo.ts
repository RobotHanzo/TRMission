import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import type { DashboardPermission, DashboardRole } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';

/**
 * One dashboard-access record per maintainer, keyed by the existing account id
 * (`_id` = `users._id`). Only the role and the per-account overrides live here;
 * the role → permission expansion is code (`@trm/shared` `ROLE_PERMISSIONS`).
 */
export interface DashboardAccountDoc {
  _id: string; // = users._id
  role: DashboardRole;
  extraPermissions?: DashboardPermission[];
  deniedPermissions?: DashboardPermission[];
  /** Who granted access: a maintainer's userId, or 'system:env' for boot seeding. */
  grantedBy: string;
  grantedAt: Date;
  updatedAt: Date;
}

export interface DashboardAccountPatch {
  role: DashboardRole;
  extraPermissions?: DashboardPermission[];
  deniedPermissions?: DashboardPermission[];
}

@Injectable()
export class DashboardAccountRepo implements OnModuleInit {
  private readonly col: Collection<DashboardAccountDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<DashboardAccountDoc>('dashboardAccounts');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ role: 1 }); // last-owner protection count
  }

  findById(userId: string): Promise<DashboardAccountDoc | null> {
    return this.col.findOne({ _id: userId });
  }

  list(): Promise<DashboardAccountDoc[]> {
    return this.col.find({}).sort({ grantedAt: 1 }).toArray();
  }

  /**
   * Create or replace a maintainer's role + overrides. A PUT is a full replacement of the
   * record, so override arrays absent from the patch are cleared ($set/$unset touch
   * different paths, which Mongo allows in one update).
   */
  async upsert(
    userId: string,
    patch: DashboardAccountPatch,
    grantedBy: string,
  ): Promise<DashboardAccountDoc> {
    const now = new Date();
    const set: Record<string, unknown> = { role: patch.role, updatedAt: now };
    const unset: Record<string, ''> = {};
    if (patch.extraPermissions?.length) set.extraPermissions = patch.extraPermissions;
    else unset.extraPermissions = '';
    if (patch.deniedPermissions?.length) set.deniedPermissions = patch.deniedPermissions;
    else unset.deniedPermissions = '';
    const doc = await this.col.findOneAndUpdate(
      { _id: userId },
      { $set: set, $unset: unset, $setOnInsert: { grantedBy, grantedAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new Error('upsert returned no document');
    return doc;
  }

  async remove(userId: string): Promise<boolean> {
    const res = await this.col.deleteOne({ _id: userId });
    return res.deletedCount === 1;
  }

  countOwners(): Promise<number> {
    return this.col.countDocuments({ role: 'owner' });
  }
}
