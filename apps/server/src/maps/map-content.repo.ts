import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import type { MapContentDoc } from './maps.types';

const isDuplicateKey = (e: unknown): boolean => (e as { code?: number })?.code === 11000;

/**
 * Immutable, hash-addressed published map content. Written once at game start and never
 * mutated or garbage-collected — a persisted game's recovery/replay must be able to resolve
 * its contentHash forever, even after the owning draft (customMaps) is edited or deleted.
 */
@Injectable()
export class MapContentRepo implements OnModuleInit {
  private readonly col: Collection<MapContentDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<MapContentDoc>('mapContents');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ ownerId: 1 });
    await this.col.createIndex({ sourceMapId: 1 });
  }

  findByHash(hash: string): Promise<MapContentDoc | null> {
    return this.col.findOne({ _id: hash });
  }

  /** Batched existence check by hash — mirrors `HistoryRepo.replayableFlags`' fallback lookup,
   *  reused by the public room listing's compatibility filter. */
  async existingHashes(hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const docs = await this.col
      .find({ _id: { $in: hashes } }, { projection: { _id: 1 } })
      .toArray();
    return new Set(docs.map((d) => d._id));
  }

  /** Insert-if-absent: identical hash ⇒ identical content, so a collision is always safe to drop. */
  async insertIfAbsent(doc: MapContentDoc): Promise<void> {
    try {
      await this.col.insertOne(doc);
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
  }

  /** Every published revision of one custom map (for admin usage-count aggregation). */
  findBySourceMapId(sourceMapId: string): Promise<MapContentDoc[]> {
    return this.col.find({ sourceMapId }).toArray();
  }
}
