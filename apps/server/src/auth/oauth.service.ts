import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuthConfig, type OauthProvider } from './auth-config';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { UserRepo, type UserDoc } from './user.repo';
import { SessionRepo } from './session.repo';
import { OAUTH_HTTP, type OauthHttp } from './oauth.http';
import type { IssuedAuth, Locale } from './auth.types';

const base64url = (b: Buffer): string => b.toString('base64url');

/** True if the string contains any C0 control char or DEL (CR/LF included). */
const hasControlChar = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};

/**
 * Constrain a post-login redirect to a same-origin path so the flow can't be turned into an
 * open redirect. The value is already URL-decoded by the query parser; we deliberately do NOT
 * decode again (double-decoding is a classic bypass). Anything non-conforming falls back to '/'.
 */
export const safeRedirect = (p: unknown): string => {
  // `p` is `string | undefined` by type, but a raw @Query param can arrive as an array/object
  // (e.g. ?redirect=/a&redirect=/b) — guard the type before any string method runs.
  if (typeof p !== 'string' || p.length > 512) return '/';
  if (!p.startsWith('/') || p.startsWith('//')) return '/';
  if (p.includes('\\') || p.includes('://')) return '/';
  if (hasControlChar(p)) return '/'; // reject CR/LF & control chars (header-injection guard)
  return p;
};

const isDuplicateKey = (e: unknown): boolean => (e as { code?: number })?.code === 11000;

/** Provider display names ⇒ a clean, length-bounded account display name. */
const cleanDisplayName = (raw: string, email: string): string => {
  const trimmed = raw.trim();
  const base = trimmed || email.split('@')[0] || 'Player';
  return base.slice(0, 24);
};

export type CallbackResult =
  | { ok: true; issued: IssuedAuth; redirect: string }
  | { ok: false; error: string; redirect: string };

@Injectable()
export class OauthService {
  constructor(
    private readonly authConfig: AuthConfig,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly users: UserRepo,
    private readonly sessions: SessionRepo,
    @Inject(OAUTH_HTTP) private readonly http: OauthHttp,
  ) {}

  /**
   * Resolve the GUEST id behind a refresh cookie, for the in-place-upgrade path. Returns undefined
   * for anonymous or already-registered users (those resolve by email in the callback instead).
   */
  async guestIdFromRefresh(refreshToken: string | undefined): Promise<string | undefined> {
    const userId = await this.sessions.peekUserId(refreshToken);
    if (!userId) return undefined;
    const user = await this.users.findById(userId);
    return user?.isGuest ? user._id : undefined;
  }

  /**
   * Build the provider authorization URL + the CSRF nonce to set as the `trm_oauth` cookie. Caller
   * is responsible for confirming the provider is enabled (the controller does, returning 404).
   */
  buildAuthorize(
    provider: OauthProvider,
    redirect: string | undefined,
    guestUserId?: string,
  ): { url: string; nonce: string } | null {
    const cfg = this.authConfig.provider(provider);
    if (!cfg) return null;

    const nonce = base64url(randomBytes(24));
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
    const state = this.tokens.signOauthState({
      provider,
      redirect: safeRedirect(redirect),
      nonce,
      codeVerifier,
      ...(guestUserId ? { guestUserId } : {}),
    });

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: this.authConfig.callbackUrl(provider),
      response_type: 'code',
      scope: cfg.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    if (provider === 'google') params.set('prompt', 'select_account');

    return { url: `${cfg.authorizeUrl}?${params.toString()}`, nonce };
  }

  /**
   * Verify the round-trip (signed state + nonce cookie), exchange the code, require a verified
   * email, then resolve the account: (a) upgrade a live guest in place when the email is unused,
   * (b) auto-link & sign into the existing same-email account, or (c) create a new passwordless one.
   */
  async handleCallback(
    provider: OauthProvider,
    code: string | undefined,
    state: string | undefined,
    nonceCookie: string | undefined,
  ): Promise<CallbackResult> {
    if (!code || !state) return { ok: false, error: 'invalid_request', redirect: '/' };

    const payload = this.tokens.verifyOauthState(state);
    if (!payload || payload.provider !== provider) {
      return { ok: false, error: 'invalid_state', redirect: '/' };
    }
    const redirect = safeRedirect(payload.redirect);
    if (!nonceCookie || nonceCookie !== payload.nonce) {
      return { ok: false, error: 'invalid_state', redirect };
    }
    const cfg = this.authConfig.provider(provider);
    if (!cfg) return { ok: false, error: 'provider_disabled', redirect };

    let profile;
    try {
      profile = await this.http.getProfile(
        cfg,
        code,
        this.authConfig.callbackUrl(provider),
        payload.codeVerifier,
      );
    } catch {
      return { ok: false, error: 'exchange_failed', redirect };
    }
    if (!profile.email || !profile.emailVerified || !profile.sub) {
      return { ok: false, error: 'email_unverified', redirect };
    }

    // Account resolution + issuance is a DB sequence with a (narrow) unique-email race; never let a
    // failure bubble to a raw 500 on what is a top-level browser navigation — redirect with an error.
    try {
      const user = await this.resolveAccount(
        provider,
        profile.email,
        profile.sub,
        profile.displayName,
        profile.avatarUrl,
        payload.guestUserId,
      );
      const issued = await this.auth.issueFor(user);
      return { ok: true, issued, redirect };
    } catch {
      return { ok: false, error: 'server_error', redirect };
    }
  }

  private async resolveAccount(
    provider: OauthProvider,
    email: string,
    sub: string,
    rawName: string,
    avatarUrl: string | null,
    guestUserId: string | undefined,
  ): Promise<UserDoc> {
    const locale: Locale = 'zh-Hant';

    // (a) Logged-in guest + unused email → upgrade in place (keep id + match history).
    if (guestUserId && !(await this.users.findByEmail(email))) {
      try {
        const upgraded = await this.users.attachOauthToGuest(
          guestUserId,
          email,
          provider,
          sub,
          avatarUrl,
        );
        if (upgraded) {
          // Prior guest refresh families die with the upgrade (the new one is minted by the caller).
          await this.sessions.revokeAllForUser(upgraded._id);
          return upgraded;
        }
        // Doc is no longer a guest (raced an upgrade) → fall through to normal resolution.
      } catch (e) {
        // The email was claimed between the check and the $set (unique index) → resolve by email.
        if (!isDuplicateKey(e)) throw e;
      }
    }

    // (b) Same verified email already exists → auto-link the provider identity (refresh avatar).
    const existing = await this.users.findByEmail(email);
    if (existing) {
      return (await this.users.linkOauthIdentity(existing._id, provider, sub, avatarUrl)) ?? existing;
    }

    // (c) Brand-new account. Guard the unique-email race (two first logins for one email).
    try {
      return await this.users.createOauthUser(
        email,
        cleanDisplayName(rawName, email),
        provider,
        sub,
        locale,
        avatarUrl,
      );
    } catch (e) {
      if (isDuplicateKey(e)) {
        const raced = await this.users.findByEmail(email);
        if (raced)
          return (await this.users.linkOauthIdentity(raced._id, provider, sub, avatarUrl)) ?? raced;
      }
      throw e;
    }
  }
}
