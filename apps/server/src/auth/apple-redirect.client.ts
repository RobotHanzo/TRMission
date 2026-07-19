// The network seam for the SIWA web/Android redirect flow's authorization-code exchange —
// injectable (like OAUTH_HTTP) so e2e specs fake it. Apple diverges from the shared OauthHttp:
// the identity arrives as an `id_token` in the token response (no userinfo endpoint), and the
// client_secret is a per-request ES256 JWT rather than a static string. Web-flow codes are
// exchanged WITH `redirect_uri` (unlike the native codes the revoker exchanges without it).
import { Injectable, Logger } from '@nestjs/common';
import { AuthConfig } from './auth-config';
import {
  APPLE_BASE_URL,
  appleSecretConfigured,
  mintAppleClientSecret,
} from './apple-client-secret';

export interface AppleRedirectClient {
  /** Exchange a web-flow authorization code for the identity token. Throws on any failure. */
  exchangeCode(code: string): Promise<{ idToken: string }>;
}

export const APPLE_REDIRECT_CLIENT = Symbol('APPLE_REDIRECT_CLIENT');

@Injectable()
export class FetchAppleRedirectClient implements AppleRedirectClient {
  private readonly log = new Logger('AppleRedirectClient');

  constructor(private readonly authConfig: AuthConfig) {}

  async exchangeCode(code: string): Promise<{ idToken: string }> {
    const clientId = this.authConfig.appleServicesId;
    if (!clientId || !appleSecretConfigured()) {
      this.log.warn(
        'apple redirect flow not configured (missing APPLE_SERVICES_ID / APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY)',
      );
      throw new Error('apple redirect flow not configured');
    }
    const secret = await mintAppleClientSecret(clientId);
    const res = await fetch(`${APPLE_BASE_URL}/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: secret,
        redirect_uri: this.authConfig.appleCallbackUrl(),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable body>');
      this.log.warn(`apple code exchange failed: ${res.status} ${body}`);
      throw new Error(`apple exchange failed: ${res.status}`);
    }
    const tokens = (await res.json()) as { id_token?: string };
    if (!tokens.id_token) {
      this.log.warn('apple exchange response had no id_token');
      throw new Error('apple exchange returned no id_token');
    }
    return { idToken: tokens.id_token };
  }
}
