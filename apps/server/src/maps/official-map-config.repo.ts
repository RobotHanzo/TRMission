import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';

export interface OfficialMapConfigDoc {
  _id: 'singleton';
  /** Official `mapId`s a maintainer has switched OFF. */
  disabledMapIds: string[];
}

/**
 * Which official maps are currently offered, stored as the DISABLED set (one document, fixed
 * `_id`, same posture as `FeatureDefaultsRepo`). Storing the negative is what makes a newly
 * shipped official map available the moment it lands — nobody has to remember to add it to an
 * allowlist in Mongo. Read fresh on every use; never cached.
 */
@Injectable()
export class OfficialMapConfigRepo {
  private readonly col: Collection<OfficialMapConfigDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<OfficialMapConfigDoc>('officialMapConfig');
  }

  async getDisabled(): Promise<string[]> {
    const doc = await this.col.findOne({ _id: 'singleton' });
    return doc?.disabledMapIds ?? [];
  }

  async setDisabled(disabledMapIds: string[]): Promise<string[]> {
    const doc = await this.col.findOneAndUpdate(
      { _id: 'singleton' },
      { $set: { disabledMapIds } },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new Error('upsert returned no document');
    return doc.disabledMapIds;
  }
}
