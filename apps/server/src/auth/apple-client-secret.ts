// The ES256 Apple "client secret" (developer token), shared by the SIWA redirect flow's
// authorization-code exchange (apple-redirect.client.ts) and best-effort token revocation on
// account deletion (account/apple-token-revoker.ts). kid header = key id; iss = team id;
// sub = the flow's client id (the native bundle id for app-flow codes, the Services ID for web).
import { SignJWT, importPKCS8 } from 'jose';
import { env } from '../config/env';

export const APPLE_BASE_URL = 'https://appleid.apple.com';

/** True when the ES256 signing material (team id + key id + private key) is configured. */
export const appleSecretConfigured = (): boolean =>
  !!(env.appleTeamId && env.appleKeyId && env.applePrivateKey);

export async function mintAppleClientSecret(clientId: string): Promise<string> {
  const key = await importPKCS8(env.applePrivateKey, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.appleKeyId })
    .setIssuer(env.appleTeamId)
    .setSubject(clientId)
    .setAudience(APPLE_BASE_URL)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);
}
