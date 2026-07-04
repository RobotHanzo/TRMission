import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import type { OauthProfile } from './oauth.http';

/** Verifies a Google Identity Services credential (ID token JWT) and normalizes its payload. */
export interface GoogleIdTokenVerifier {
  verify(idToken: string, audience: string): Promise<OauthProfile>;
}

export const GOOGLE_ID_TOKEN_VERIFIER = Symbol('GOOGLE_ID_TOKEN_VERIFIER');

/** Google sometimes serializes `email_verified` as the string "true". */
const truthy = (v: unknown): boolean => v === true || v === 'true';

/**
 * Real implementation: delegates JWKS fetch/cache/rotation and signature/audience/issuer/expiry
 * checks to google-auth-library. Unlike `oauth.http.ts`'s authorization-code exchange, there is no
 * code-exchange step to lean on here — the JWT signature is the only proof of identity, so this is
 * not worth hand-rolling.
 */
@Injectable()
export class GoogleAuthLibraryVerifier implements GoogleIdTokenVerifier {
  private readonly client = new OAuth2Client();

  async verify(idToken: string, audience: string): Promise<OauthProfile> {
    const ticket = await this.client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload) throw new Error('google id token carried no payload');
    return {
      sub: payload.sub,
      email: payload.email ?? null,
      emailVerified: truthy(payload.email_verified),
      displayName: payload.name ?? '',
      avatarUrl: payload.picture ?? null,
    };
  }
}
