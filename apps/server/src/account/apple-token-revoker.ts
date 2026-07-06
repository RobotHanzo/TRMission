import { Injectable, Logger } from '@nestjs/common';
import { SignJWT, importPKCS8 } from 'jose';
import { env } from '../config/env';

/**
 * Best-effort Sign in with Apple token revocation for account deletion (TN3194):
 * exchange the fresh authorizationCode the client re-authenticated for, then revoke
 * the resulting refresh token. Never throws — deletion must proceed regardless.
 */
export interface AppleTokenRevoker {
  /** true = revoked; false = not configured, exchange failed, or revoke failed. */
  revoke(authorizationCode: string): Promise<boolean>;
}

export const APPLE_TOKEN_REVOKER = Symbol('APPLE_TOKEN_REVOKER');

const APPLE_BASE = 'https://appleid.apple.com';

@Injectable()
export class FetchAppleTokenRevoker implements AppleTokenRevoker {
  private readonly log = new Logger('AppleTokenRevoker');

  private get clientId(): string {
    return env.appleClientIds[0] ?? '';
  }

  private get configured(): boolean {
    return !!(env.appleTeamId && env.appleKeyId && env.applePrivateKey && this.clientId);
  }

  /** ES256 client secret: kid header = key id; iss = team id; sub = client id (case-sensitive). */
  private async clientSecret(): Promise<string> {
    const key = await importPKCS8(env.applePrivateKey, 'ES256');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: env.appleKeyId })
      .setIssuer(env.appleTeamId)
      .setSubject(this.clientId)
      .setAudience(APPLE_BASE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);
  }

  async revoke(authorizationCode: string): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const secret = await this.clientSecret();
      // Native-flow codes are exchanged WITHOUT redirect_uri (web-flow-only parameter).
      const exchange = await fetch(`${APPLE_BASE}/auth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authorizationCode,
          client_id: this.clientId,
          client_secret: secret,
        }),
      });
      if (!exchange.ok) {
        this.log.warn(`apple token exchange failed: ${exchange.status}`);
        return false;
      }
      const tokens = (await exchange.json()) as { refresh_token?: string };
      if (!tokens.refresh_token) return false;
      const revoke = await fetch(`${APPLE_BASE}/auth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: secret,
          token: tokens.refresh_token,
          token_type_hint: 'refresh_token',
        }),
      });
      if (!revoke.ok) this.log.warn(`apple revoke failed: ${revoke.status}`);
      return revoke.ok;
    } catch (e) {
      this.log.warn(`apple revocation error: ${(e as Error).message}`);
      return false;
    }
  }
}
