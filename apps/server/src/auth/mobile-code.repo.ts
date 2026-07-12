import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';

/**
 * Single-use, short-lived opaque codes for the mobile auth flows:
 *  - 'exchange': minted by the OAuth callback, redeemed by POST /auth/mobile/exchange
 *    for a fresh session (the deep-link-safe replacement for the Strict refresh cookie).
 *  - 'carry': minted over Bearer before the system browser opens, so the OAuth `start`
 *    can identify the app's signed-in guest (no cookie crosses that boundary).
 * Redemption is a findOneAndDelete — a code can never be used twice, even in a race.
 */
export type MobileCodeKind = 'exchange' | 'carry';

interface MobileCodeDoc {
  _id: string; // the code itself (256-bit, base64url)
  kind: MobileCodeKind;
  userId: string;
  expiresAt: Date; // TTL
}

@Injectable()
export class MobileCodeRepo implements OnModuleInit {
  private readonly col: Collection<MobileCodeDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<MobileCodeDoc>('mobileAuthCodes');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  async mint(kind: MobileCodeKind, userId: string, ttlMs: number): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    await this.col.insertOne({
      _id: code,
      kind,
      userId,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return code;
  }

  /** Single-use redeem: returns the userId or null (wrong kind, expired, or already used). */
  async redeem(kind: MobileCodeKind, code: string | undefined): Promise<string | null> {
    if (!code) return null;
    const doc = await this.col.findOneAndDelete({
      _id: code,
      kind,
      expiresAt: { $gt: new Date() },
    });
    return doc?.userId ?? null;
  }
}
