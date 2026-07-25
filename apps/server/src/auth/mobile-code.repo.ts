import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
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
  /**
   * App-binding PKCE-style challenge (F16 hardening; 'exchange' codes only): a SHA-256 hex digest
   * of a verifier the mobile app generated before starting the flow. Redeeming an 'exchange' code
   * requires the matching verifier, so a co-installed app that only intercepts the `trmission://`
   * deep-link code — but never held the verifier — cannot redeem it.
   */
  challenge?: string;
}

const sha256Hex = (input: string): string => createHash('sha256').update(input).digest('hex');

@Injectable()
export class MobileCodeRepo implements OnModuleInit {
  private readonly col: Collection<MobileCodeDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<MobileCodeDoc>('mobileAuthCodes');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  async mint(
    kind: MobileCodeKind,
    userId: string,
    ttlMs: number,
    challenge?: string,
  ): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    await this.col.insertOne({
      _id: code,
      kind,
      userId,
      expiresAt: new Date(Date.now() + ttlMs),
      ...(challenge ? { challenge } : {}),
    });
    return code;
  }

  /**
   * Single-use redeem: returns the userId, or null on wrong kind/expired/already-used — AND, for
   * 'exchange' codes, on a missing/mismatched PKCE verifier (F16). The code is deleted regardless
   * of the verifier outcome (findOneAndDelete happens first), so a redemption attempt with the
   * wrong verifier still burns the code instead of leaving it available for a retry, and the
   * caller sees the same "invalid or expired code" either way — never a distinct signal for
   * "the code was valid but the verifier wasn't."
   */
  async redeem(
    kind: MobileCodeKind,
    code: string | undefined,
    verifier?: string,
  ): Promise<string | null> {
    if (!code) return null;
    const doc = await this.col.findOneAndDelete({
      _id: code,
      kind,
      expiresAt: { $gt: new Date() },
    });
    if (!doc) return null;
    if (kind === 'exchange') {
      // Every 'exchange' code minted post-fix carries a challenge; a code with none (a bug, or a
      // pre-fix code somehow still alive) fails closed rather than silently skipping the check.
      if (!doc.challenge || !verifier || sha256Hex(verifier) !== doc.challenge) return null;
    }
    return doc.userId;
  }
}
