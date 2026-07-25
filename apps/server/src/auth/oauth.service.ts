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
import { safeRedirect } from './safe-redirect';

// Re-exported for backwards compatibility: `safeRedirect` now lives in ./safe-redirect so the
// unauthenticated OG page renderer can reuse the exact same same-origin guard (see og.service.ts).
export { safeRedirect };

const base64url = (b: Buffer): string => b.toString('base64url');

const isDuplicateKey = (e: unknown): boolean => (e as { code?: number })?.code === 11000;

/**
 * True once an account already holds at least one linked provider identity — proof that a provider
 * verified this account's email at least once. A password-only account never has one, and this
 * server has no email-verification flow, so treat that account's email as UNVERIFIED: it must not
 * capture a fresh OAuth sign-in on the same address (CWE-287 pre-registration account hijacking).
 */
const hasLinkedOauthIdentity = (u: UserDoc): boolean =>
  !!u.oauth && Object.keys(u.oauth).length > 0;

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
  | { ok: true; user: UserDoc; redirect: string; mobile: boolean; mobileChallenge?: string }
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
    mobileChallenge?: string,
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
      ...(mobileChallenge ? { mobileChallenge } : {}),
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
   * (b) auto-link & sign into an existing same-email account ONLY when that account's email was
   * already provider-verified (else a separate account is created), or (c) create a new
   * passwordless one.
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
      return {
        ok: true,
        user,
        redirect,
        mobile,
        ...(payload.mobileChallenge ? { mobileChallenge: payload.mobileChallenge } : {}),
      };
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
    mobileChallenge?: string,
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
      ...(mobileChallenge ? { mobileChallenge } : {}),
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
   * redirect flow. Nonce rule: the `trm_oauth_apple` cookie minted at /start must ALWAYS be
   * present and match the signed state's nonce — this CSRF binding is a security invariant, not
   * something environments can opt out of. It is deliberately independent of `env.cookieSecure`
   * (which only controls that cookie's own Secure/SameSite attributes, see appleStart): Apple
   * requires the redirect flow's Return URL to be HTTPS, so a legitimate round trip always
   * carries the cookie, and a request that arrives without it (or with a mismatched one) is
   * rejected regardless of deployment configuration.
   */
  async handleAppleRedirectCallback(
    code: string | undefined,
    state: string | undefined,
    userField: string | undefined,
    nonceCookie: string | undefined,
  ): Promise<CallbackResult> {
    if (!code || !state) return { ok: false, error: 'invalid_request', redirect: '/' };

    const payload = this.tokens.verifyOauthState(state);
    if (!payload || payload.provider !== 'apple') {
      return { ok: false, error: 'invalid_state', redirect: '/' };
    }
    const redirect = safeRedirect(payload.redirect);
    const mobile = !!payload.mobile;
    if (nonceCookie !== payload.nonce) {
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
      return {
        ok: true,
        user,
        redirect,
        mobile,
        ...(payload.mobileChallenge ? { mobileChallenge: payload.mobileChallenge } : {}),
      };
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

    // (0) Returning provider identity → resolve by (provider, sub), the authoritative key for an
    // OAuth account. Runs first so a linked identity always maps back to its OWN account and never
    // re-links onto (or duplicates against) a same-email account; also refreshes the avatar.
    const byIdentity = await this.users.findByOauth(provider, sub);
    if (byIdentity) {
      return (
        (await this.users.linkOauthIdentity(byIdentity._id, provider, sub, avatarUrl)) ?? byIdentity
      );
    }

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

    // (b) An account already holds this email. Auto-link the provider identity ONLY when that
    // account's email was already provider-verified (it holds a linked OAuth identity). A
    // password-only account's email is UNVERIFIED — linking a fresh identity into it would hand
    // whoever pre-registered the address a session on the real owner's provider sign-in (F2), so
    // instead create a SEPARATE account for this identity (emailless: the address is taken).
    const existing = await this.users.findByEmail(email);
    if (existing) {
      if (hasLinkedOauthIdentity(existing)) {
        return (
          (await this.users.linkOauthIdentity(existing._id, provider, sub, avatarUrl)) ?? existing
        );
      }
      return this.users.createOauthUser(
        null,
        cleanDisplayName(rawName, email),
        provider,
        sub,
        locale,
        avatarUrl,
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
        if (raced) {
          // Same verified-email gate as (b): only adopt the raced account when its email was
          // provider-proven; an unverified password claim gets a separate emailless account.
          if (hasLinkedOauthIdentity(raced)) {
            return (
              (await this.users.linkOauthIdentity(raced._id, provider, sub, avatarUrl)) ?? raced
            );
          }
          return this.users.createOauthUser(
            null,
            cleanDisplayName(rawName, email),
            provider,
            sub,
            locale,
            avatarUrl,
          );
        }
      }
      throw e;
    }
  }
}
