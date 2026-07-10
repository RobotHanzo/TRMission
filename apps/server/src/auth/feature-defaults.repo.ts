import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import type { UserFeature } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';

export interface FeatureDefaultsDoc {
  _id: 'singleton';
  features: UserFeature[];
}

/** Shipped default until a maintainer has ever saved a value from the dashboard — lets a new
 *  default (e.g. turning randomEvents on) take effect immediately, with no boot-time seed step. */
export const INITIAL_DEFAULTS: readonly UserFeature[] = ['randomEvents'];

/**
 * The global feature-flag defaults, granted to every account on top of whatever a maintainer
 * has explicitly granted that account (`UserRepo.hasFeature` / `AuthService` union the two).
 * One document, fixed `_id`. Read fresh on every request — same "never cached, never baked
 * into new accounts" posture as per-account feature grants.
 */
@Injectable()
export class FeatureDefaultsRepo {
  private readonly col: Collection<FeatureDefaultsDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<FeatureDefaultsDoc>('featureDefaults');
  }

  async get(): Promise<UserFeature[]> {
    const doc = await this.col.findOne({ _id: 'singleton' });
    return doc ? doc.features : [...INITIAL_DEFAULTS];
  }

  async set(features: UserFeature[]): Promise<UserFeature[]> {
    const doc = await this.col.findOneAndUpdate(
      { _id: 'singleton' },
      { $set: { features } },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new Error('upsert returned no document');
    return doc.features;
  }
}
