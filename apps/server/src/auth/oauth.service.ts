import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuthConfig, type IdentityProvider, type OauthProvider } from './auth-config';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { UserRepo, type UserDoc } from './user.repo';
import { SessionRepo } from './session.repo';
import { MobileCodeRepo } from './mobile-code.repo';
import { OAUTH_HTTP, type OauthHttp } from './oauth.http';
import { GOOGLE_ID_TOKEN_VERIFIER, type GoogleIdTokenVerifier } from './google-id-token.verifier';
import { APPLE_ID_TOKEN_VERIFIER, type AppleIdTokenVerifier } from './apple-id-token.verifier';
import { APPLE_REDIRECT_CLIENT, type AppleRedirectClient } from './apple-redirect.client';
import { APPLE_BASE_URL } from './apple-client-secret';
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

/** Apple's form_post `user` field (FIRST authorization only): a JSON blob carrying the chosen
 *  name. Anything malformed simply yields undefined — the email local-part fallback applies. */
const appleNameFromUserField = (userField: string | undefined): string | undefined => {
  if (!userField || userField.length > 2048) return undefined;
  try {
    const parsed = JSON.parse(userField) as {
      name?: { firstName?: unknown; lastName?: unknown };
    };
    const first = typeof parsed.name?.firstName === 'string' ? parsed.name.firstName.trim() : '';
    const last = typeof parsed.name?.lastName === 'string' ? parsed.name.lastName.trim() : '';
    const joined = [first, last].filter(Boolean).join(' ');
    return joined || undefined;
  } catch {
    return undefined;
  }
};

export type CallbackResult =
  | { ok: true; user: UserDoc; redirect: string; mobile: boolean }
  | { ok: false; error: string; redirect: string; mobile?: boolean };

@Injectable()
export class OauthService {
  private readonly log = new Logger('OauthService');

  constructor(
    private readonly authConfig: AuthConfig,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly users: UserRepo,
    private readonly sessions: SessionRepo,
    private readonly mobileCodes: MobileCodeRepo,
    @Inject(OAUTH_HTTP) private readonly http: OauthHttp,
    @Inject(GOOGLE_ID_TOKEN_VERIFIER) private readonly verifier: GoogleIdTokenVerifier,
    @Inject(APPLE_ID_TOKEN_VERIFIER) private readonly appleVerifier: AppleIdTokenVerifier,
    @Inject(APPLE_REDIRECT_CLIENT) private readonly appleRedirect: AppleRedirectClient,
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

  /** Mobile flavor of guestIdFromRefresh: the app minted a single-use carry code over Bearer. */
  async guestIdFromCarryCode(code: string | undefined): Promise<string | undefined> {
    const userId = await this.mobileCodes.redeem('carry', code);
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
    mobile = false,
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
      ...(mobile ? { mobile: true } : {}),
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
    const mobile = !!payload.mobile;
    if (!nonceCookie || nonceCookie !== payload.nonce) {
      return { ok: false, error: 'invalid_state', redirect, mobile };
    }
    const cfg = this.authConfig.provider(provider);
    if (!cfg) return { ok: false, error: 'provider_disabled', redirect, mobile };

    let profile;
    try {
      profile = await this.http.getProfile(
        cfg,
        code,
        this.authConfig.callbackUrl(provider),
        payload.codeVerifier,
      );
    } catch (e) {
      this.log.warn(`${provider} code exchange failed: ${(e as Error).message}`);
      return { ok: false, error: 'exchange_failed', redirect, mobile };
    }
    if (!profile.email || !profile.emailVerified || !profile.sub) {
      return { ok: false, error: 'email_unverified', redirect, mobile };
    }

    // Account resolution is a DB sequence with a (narrow) unique-email race; never let a
    // failure bubble to a raw 500 on what is a top-level browser navigation — redirect with an
    // error. Session issuance moved to the caller: web sets the cookie, mobile mints a code.
    try {
      const user = await this.resolveAccount(
        provider,
        profile.email,
        profile.sub,
        profile.displayName,
        profile.avatarUrl,
        payload.guestUserId,
      );
      return { ok: true, user, redirect, mobile };
    } catch {
      return { ok: false, error: 'server_error', redirect, mobile };
    }
  }

  /**
   * Build Apple's authorization URL + the CSRF nonce for the SIWA web/Android redirect flow.
   * `response_mode=form_post` is REQUIRED whenever the name/email scope is requested — the
   * callback arrives as a cross-site POST (see handleAppleRedirectCallback's nonce rules).
   * Apple ignores PKCE, so the state carries an empty codeVerifier; identity comes from the
   * id_token the token exchange returns.
   */
  buildAppleAuthorize(
    redirect: string | undefined,
    guestUserId?: string,
    mobile = false,
  ): { url: string; nonce: string } | null {
    if (!this.authConfig.appleRedirectEnabled) return null;

    const nonce = base64url(randomBytes(24));
    const state = this.tokens.signOauthState({
      provider: 'apple',
      redirect: safeRedirect(redirect),
      nonce,
      codeVerifier: '',
      ...(guestUserId ? { guestUserId } : {}),
      ...(mobile ? { mobile: true } : {}),
    });

    const params = new URLSearchParams({
      client_id: this.authConfig.appleServicesId,
      redirect_uri: this.authConfig.appleCallbackUrl(),
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state,
    });
    return { url: `${APPLE_BASE_URL}/auth/authorize?${params.toString()}`, nonce };
  }

  /**
   * The Apple form_post callback: verify the signed state, exchange the code for an id_token,
   * verify it against every accepted audience, and resolve the account exactly like the shared
   * redirect flow. Nonce rule: Apple's callback is a CROSS-SITE POST, which no Lax cookie rides —
   * the Apple nonce cookie is SameSite=None and only exists over HTTPS (`requireNonce` =
   * cookieSecure). A present cookie must always match; over dev http the signed short-TTL state
   * is the sole CSRF binding (documented dev limitation).
   */
  async handleAppleRedirectCallback(
    code: string | undefined,
    state: string | undefined,
    userField: string | undefined,
    nonceCookie: string | undefined,
    requireNonce: boolean,
  ): Promise<CallbackResult> {
    if (!code || !state) return { ok: false, error: 'invalid_request', redirect: '/' };

    const payload = this.tokens.verifyOauthState(state);
    if (!payload || payload.provider !== 'apple') {
      return { ok: false, error: 'invalid_state', redirect: '/' };
    }
    const redirect = safeRedirect(payload.redirect);
    const mobile = !!payload.mobile;
    if (nonceCookie ? nonceCookie !== payload.nonce : requireNonce) {
      return { ok: false, error: 'invalid_state', redirect, mobile };
    }
    if (!this.authConfig.appleRedirectEnabled) {
      return { ok: false, error: 'provider_disabled', redirect, mobile };
    }

    let idToken: string;
    try {
      ({ idToken } = await this.appleRedirect.exchangeCode(code));
    } catch (e) {
      this.log.warn(`apple code exchange failed: ${(e as Error).message}`);
      return { ok: false, error: 'exchange_failed', redirect, mobile };
    }
    let profile;
    try {
      profile = await this.appleVerifier.verify(idToken, this.authConfig.appleAudiences());
    } catch (e) {
      this.log.warn(`apple id_token verification failed: ${(e as Error).message}`);
      return { ok: false, error: 'invalid_credential', redirect, mobile };
    }
    if (!profile.email || !profile.emailVerified || !profile.sub) {
      return { ok: false, error: 'email_unverified', redirect, mobile };
    }

    try {
      const user = await this.resolveAccount(
        'apple',
        profile.email,
        profile.sub,
        appleNameFromUserField(userField) ?? profile.displayName,
        profile.avatarUrl,
        payload.guestUserId,
      );
      return { ok: true, user, redirect, mobile };
    } catch {
      return { ok: false, error: 'server_error', redirect, mobile };
    }
  }

  /**
   * Verify a Google Identity Services credential (One Tap / rendered-button ID token) and resolve
   * the account through the same logic `handleCallback` uses. Unlike that redirect flow, failures
   * here are ordinary REST errors (this is a JSON call, not a top-level navigation that must always
   * land somewhere) — no redirect/error-query-param plumbing needed.
   */
  async handleCredential(
    idToken: string,
    guestUserId: string | undefined,
    ip?: string,
  ): Promise<IssuedAuth> {
    const cfg = this.authConfig.provider('google');
    if (!cfg) throw new UnauthorizedException('provider_disabled');

    let profile;
    try {
      profile = await this.verifier.verify(idToken, this.authConfig.googleAudiences());
    } catch {
      throw new UnauthorizedException('invalid_credential');
    }
    if (!profile.email || !profile.emailVerified || !profile.sub) {
      throw new UnauthorizedException('email_unverified');
    }

    const user = await this.resolveAccount(
      'google',
      profile.email,
      profile.sub,
      profile.displayName,
      profile.avatarUrl,
      guestUserId,
    );
    return this.auth.issueFor(user, ip);
  }

  /**
   * Verify a Sign in with Apple identity token and resolve the account through the same
   * verified-email binding. Hide My Email relay addresses count as verified: Apple owns
   * deliverability, and a relay account simply won't cross-link with the user's real-email
   * accounts on other providers (accepted trade-off — see the mobile design spec).
   */
  async handleAppleCredential(
    identityToken: string,
    fullName: string | undefined,
    guestUserId: string | undefined,
    ip?: string,
  ): Promise<IssuedAuth> {
    const audiences = this.authConfig.appleClientIds;
    if (audiences.length === 0) throw new UnauthorizedException('provider_disabled');

    let profile;
    try {
      profile = await this.appleVerifier.verify(identityToken, audiences);
    } catch {
      throw new UnauthorizedException('invalid_credential');
    }
    if (!profile.email || !profile.emailVerified || !profile.sub) {
      throw new UnauthorizedException('email_unverified');
    }

    const user = await this.resolveAccount(
      'apple',
      profile.email,
      profile.sub,
      fullName ?? profile.displayName,
      profile.avatarUrl,
      guestUserId,
    );
    return this.auth.issueFor(user, ip);
  }

  private async resolveAccount(
    provider: IdentityProvider,
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
      return (
        (await this.users.linkOauthIdentity(existing._id, provider, sub, avatarUrl)) ?? existing
      );
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
