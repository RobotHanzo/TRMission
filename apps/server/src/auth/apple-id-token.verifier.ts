import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OauthProfile } from './oauth.http';

/** Verifies a Sign in with Apple identity token (RS256 JWT) and normalizes its payload. */
export interface AppleIdTokenVerifier {
  verify(idToken: string, audience: string[]): Promise<OauthProfile>;
}

export const APPLE_ID_TOKEN_VERIFIER = Symbol('APPLE_ID_TOKEN_VERIFIER');

const APPLE_ISSUER = 'https://appleid.apple.com';

/** Apple serializes email_verified as a boolean OR the string "true", depending on era. */
const truthy = (v: unknown): boolean => v === true || v === 'true';

/**
 * Real implementation: jose fetches/caches/rotates Apple's JWKS and enforces signature,
 * issuer, audience, and expiry. Apple puts no display name in the token (the native API
 * surfaces it once, client-side) and has no avatar concept — both stay empty here.
 */
@Injectable()
export class JoseAppleIdTokenVerifier implements AppleIdTokenVerifier {
  private readonly jwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

  async verify(idToken: string, audience: string[]): Promise<OauthProfile> {
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: APPLE_ISSUER,
      audience,
    });
    return {
      sub: String(payload.sub ?? ''),
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: truthy(payload.email_verified),
      displayName: '',
      avatarUrl: null,
    };
  }
}
