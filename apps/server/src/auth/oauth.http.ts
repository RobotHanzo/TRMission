import { Injectable } from '@nestjs/common';
import type { ProviderConfig } from './auth-config';

/** Provider profile normalized to the few fields the account-resolution logic needs. */
export interface OauthProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * The single seam that talks to Google/Discord over the network. Exchanging the code and reading
 * the userinfo endpoint are one logical step (the access token is never used elsewhere), so the
 * whole exchange is one method — trivial to override with a canned profile in e2e tests.
 */
export interface OauthHttp {
  getProfile(
    provider: ProviderConfig,
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<OauthProfile>;
}

export const OAUTH_HTTP = Symbol('OAUTH_HTTP');

/** Google sometimes serializes `email_verified` as the string "true". */
const truthy = (v: unknown): boolean => v === true || v === 'true';

@Injectable()
export class FetchOauthHttp implements OauthHttp {
  async getProfile(
    provider: ProviderConfig,
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<OauthProfile> {
    const tokenRes = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenRes.ok)
      throw new Error(`${provider.provider} token exchange failed (${tokenRes.status})`);
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error(`${provider.provider} returned no access token`);

    const profileRes = await fetch(provider.userinfoUrl, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
    });
    if (!profileRes.ok)
      throw new Error(`${provider.provider} userinfo failed (${profileRes.status})`);
    const raw = (await profileRes.json()) as Record<string, unknown>;

    if (provider.provider === 'google') {
      return {
        sub: String(raw.sub ?? ''),
        email: typeof raw.email === 'string' ? raw.email : null,
        emailVerified: truthy(raw.email_verified),
        displayName: typeof raw.name === 'string' ? raw.name : '',
        avatarUrl: typeof raw.picture === 'string' ? raw.picture : null,
      };
    }
    // discord
    const id = String(raw.id ?? '');
    return {
      sub: id,
      email: typeof raw.email === 'string' ? raw.email : null,
      emailVerified: truthy(raw.verified),
      displayName:
        (typeof raw.global_name === 'string' && raw.global_name) ||
        (typeof raw.username === 'string' && raw.username) ||
        '',
      // Discord exposes only an avatar hash; build the CDN URL. `a_`-prefixed hashes are animated
      // but the .png endpoint renders the static frame, which is all we need for a chip.
      avatarUrl:
        typeof raw.avatar === 'string' && id
          ? `https://cdn.discordapp.com/avatars/${id}/${raw.avatar}.png?size=128`
          : null,
    };
  }
}
