import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { env } from '../config/env';

// A refresh-token "family" per login. Rotation + reuse-detection are done with a
// single-document compare-and-swap on `currentHash`, so no multi-document transaction
// (or replica set) is needed (ADR A10).
export interface AuthSessionDoc {
  _id: string; // familyId
  userId: string;
  currentHash: string;
  createdAt: Date;
  rotatedAt: Date;
  expiresAt: Date; // TTL
  revoked?: boolean;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const newSecret = (): string => randomBytes(32).toString('base64url');
const encode = (familyId: string, secret: string): string => `${familyId}.${secret}`;
const decode = (token: string): { familyId: string; secret: string } | null => {
  const i = token.indexOf('.');
  if (i <= 0) return null;
  return { familyId: token.slice(0, i), secret: token.slice(i + 1) };
};

export type RefreshOutcome =
  | { kind: 'ok'; userId: string; token: string }
  | { kind: 'reuse' }
  | { kind: 'invalid' };

@Injectable()
export class SessionRepo implements OnModuleInit {
  private readonly col: Collection<AuthSessionDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<AuthSessionDoc>('authSessions');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.col.createIndex({ userId: 1 });
  }

  /** Open a new family; returns the plaintext refresh token (only the hash is stored). */
  async create(userId: string): Promise<string> {
    const familyId = randomUUID();
    const secret = newSecret();
    const now = new Date();
    await this.col.insertOne({
      _id: familyId,
      userId,
      currentHash: sha256(secret),
      createdAt: now,
      rotatedAt: now,
      expiresAt: new Date(now.getTime() + env.refreshTtlMs),
    });
    return encode(familyId, secret);
  }

  /** Rotate on presentation. A stale/forged secret for a live family = theft → burn it. */
  async rotate(token: string): Promise<RefreshOutcome> {
    const parsed = decode(token);
    if (!parsed) return { kind: 'invalid' };
    const family = await this.col.findOne({ _id: parsed.familyId });
    if (!family || family.revoked) return { kind: 'invalid' };

    const presented = sha256(parsed.secret);
    if (family.currentHash !== presented) {
      await this.col.updateOne({ _id: parsed.familyId }, { $set: { revoked: true } });
      return { kind: 'reuse' };
    }

    const secret = newSecret();
    const now = new Date();
    const res = await this.col.updateOne(
      { _id: parsed.familyId, currentHash: presented, revoked: { $ne: true } },
      {
        $set: {
          currentHash: sha256(secret),
          rotatedAt: now,
          expiresAt: new Date(now.getTime() + env.refreshTtlMs),
        },
      },
    );
    if (res.modifiedCount !== 1) return { kind: 'invalid' }; // lost a concurrent rotation
    return { kind: 'ok', userId: family.userId, token: encode(parsed.familyId, secret) };
  }

  async revoke(token: string): Promise<void> {
    const parsed = decode(token);
    if (parsed) await this.col.updateOne({ _id: parsed.familyId }, { $set: { revoked: true } });
  }
}
