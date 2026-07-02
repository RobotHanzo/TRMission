import { randomInt } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { emptyDraft, type CustomMapDoc, type MapDraft } from './maps.types';

// Same no-confusable-glyphs alphabet as room codes (RoomRepo), one character longer: share
// codes are shared out-of-band (chat, links) far more than room codes, so a lower collision
// rate matters more than terseness.
const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newShareCode = (): string =>
  Array.from({ length: 8 }, () => SHARE_ALPHABET.charAt(randomInt(SHARE_ALPHABET.length))).join('');

@Injectable()
export class CustomMapRepo implements OnModuleInit {
  private readonly col: Collection<CustomMapDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<CustomMapDoc>('customMaps');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ ownerId: 1, updatedAt: -1 });
    await this.col.createIndex({ shareCode: 1 }, { unique: true, sparse: true });
  }

  listByOwner(ownerId: string): Promise<CustomMapDoc[]> {
    return this.col.find({ ownerId }).sort({ updatedAt: -1 }).toArray();
  }

  findOwned(id: string, ownerId: string): Promise<CustomMapDoc | null> {
    return this.col.findOne({ _id: id, ownerId });
  }

  findById(id: string): Promise<CustomMapDoc | null> {
    return this.col.findOne({ _id: id });
  }

  findByShareCode(code: string): Promise<CustomMapDoc | null> {
    return this.col.findOne({ shareCode: code });
  }

  async create(id: string, ownerId: string, nameZh: string, nameEn: string): Promise<CustomMapDoc> {
    const now = new Date();
    const doc: CustomMapDoc = {
      _id: id,
      ownerId,
      nameZh,
      nameEn,
      revision: 1,
      draft: emptyDraft(),
      createdAt: now,
      updatedAt: now,
    };
    await this.col.insertOne(doc);
    return doc;
  }

  /** Owner-scoped update; bumps `revision` only when the draft itself changed. */
  update(
    id: string,
    ownerId: string,
    patch: { nameZh?: string | undefined; nameEn?: string | undefined; draft?: MapDraft | undefined },
  ): Promise<CustomMapDoc | null> {
    const set: Partial<CustomMapDoc> = { updatedAt: new Date() };
    if (patch.nameZh !== undefined) set.nameZh = patch.nameZh;
    if (patch.nameEn !== undefined) set.nameEn = patch.nameEn;
    if (patch.draft !== undefined) set.draft = patch.draft;
    return this.col.findOneAndUpdate(
      { _id: id, ownerId },
      { $set: set, ...(patch.draft !== undefined ? { $inc: { revision: 1 } } : {}) },
      { returnDocument: 'after' },
    );
  }

  async remove(id: string, ownerId: string): Promise<boolean> {
    const res = await this.col.deleteOne({ _id: id, ownerId });
    return res.deletedCount === 1;
  }

  /** Mint a fresh code (retrying on the rare collision) and store it; returns the code. */
  async mintShareCode(id: string, ownerId: string): Promise<string | null> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = newShareCode();
      try {
        const res = await this.col.findOneAndUpdate(
          { _id: id, ownerId },
          { $set: { shareCode: code, updatedAt: new Date() } },
          { returnDocument: 'after' },
        );
        if (!res) return null; // no such owned map
        return code;
      } catch {
        // duplicate share code — retry with a new one
      }
    }
    throw new Error('could not allocate a share code');
  }

  async revokeShareCode(id: string, ownerId: string): Promise<boolean> {
    const res = await this.col.updateOne({ _id: id, ownerId }, { $unset: { shareCode: '' } });
    return res.matchedCount === 1;
  }
}
