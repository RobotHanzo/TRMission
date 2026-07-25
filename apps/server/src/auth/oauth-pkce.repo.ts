import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';

/**
 * Server-side store for the PKCE `code_verifier` during the OAuth authorization-code flow (F34):
 * the verifier never travels in the signed `state` JWT (a JWT payload is base64url, not
 * confidential) — only this opaque 256-bit handle does. `mint` is called by `buildAuthorize`.
 *
 * `peek` is a NON-destructive read, deliberately: the callback handler uses it to fetch the
 * verifier for the provider token exchange, but a request that merely presents a well-formed
 * handle+nonce (e.g. a forged callback probe replaying a leaked authorize/callback URL, with a
 * garbage `code` that will never exchange successfully) must not be able to destroy the record a
 * real, still-in-flight login needs. Only `consume`, called by the callback ONLY after the
 * provider token exchange has actually succeeded, may delete it. The TTL mirrors the signed
 * state's own lifetime (`OAUTH_STATE_TTL_MS`), so an abandoned record never lingers past that.
 */
interface OauthPkceDoc {
  _id: string; // the handle (256-bit, base64url) carried in the state JWT
  codeVerifier: string;
  expiresAt: Date; // TTL
}

@Injectable()
export class OauthPkceRepo implements OnModuleInit {
  private readonly col: Collection<OauthPkceDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<OauthPkceDoc>('oauthPkceVerifiers');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  async mint(codeVerifier: string, ttlMs: number): Promise<string> {
    const handle = randomBytes(32).toString('base64url');
    await this.col.insertOne({
      _id: handle,
      codeVerifier,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return handle;
  }

  /** Non-destructive read: the stored verifier, or null if absent/expired. Does NOT consume it. */
  async peek(handle: string | undefined): Promise<string | null> {
    if (!handle) return null;
    const doc = await this.col.findOne({ _id: handle, expiresAt: { $gt: new Date() } });
    return doc?.codeVerifier ?? null;
  }

  /** Explicit single-use delete — call ONLY once the provider token exchange has succeeded. */
  async consume(handle: string): Promise<void> {
    await this.col.deleteOne({ _id: handle });
  }
}
