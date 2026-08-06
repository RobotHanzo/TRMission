import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import type { TrainCarSkin } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';

export interface TrainCarSkinConfigDoc {
  _id: 'singleton';
  /** Skin packs a maintainer has switched OFF. */
  disabledSkinIds: TrainCarSkin[];
}

/**
 * Which train-card skin packs are currently offered, stored as the DISABLED set (one document,
 * fixed `_id`, same posture as `OfficialMapConfigRepo` and `FeatureDefaultsRepo`). Storing the
 * negative is what makes a newly shipped pack available the moment it lands — nobody has to
 * remember to add it to an allowlist in Mongo. Read fresh on every use; never cached.
 */
@Injectable()
export class TrainCarSkinConfigRepo {
  private readonly col: Collection<TrainCarSkinConfigDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<TrainCarSkinConfigDoc>('trainCarSkinConfig');
  }

  async getDisabled(): Promise<TrainCarSkin[]> {
    const doc = await this.col.findOne({ _id: 'singleton' });
    return doc?.disabledSkinIds ?? [];
  }

  async setDisabled(disabledSkinIds: TrainCarSkin[]): Promise<TrainCarSkin[]> {
    const doc = await this.col.findOneAndUpdate(
      { _id: 'singleton' },
      { $set: { disabledSkinIds } },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new Error('upsert returned no document');
    return doc.disabledSkinIds;
  }
}
