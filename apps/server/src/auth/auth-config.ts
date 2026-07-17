import { Injectable, Optional } from '@nestjs/common';
import { env } from '../config/env';

export type OauthProvider = 'google' | 'discord';
export const OAUTH_PROVIDERS: readonly OauthProvider[] = ['google', 'discord'];

/** Providers an account identity can be linked under. Apple sits outside OAUTH_PROVIDERS: its
 *  native path is credential-only, and its web/Android redirect flow diverges enough from the
 *  shared PKCE+userinfo machinery (form_post callback, per-request ES256 client_secret, identity
 *  from the id_token) that it has dedicated routes — see auth.controller appleStart/appleCallback. */
export type IdentityProvider = OauthProvider | 'apple';

/** Everything needed to drive one provider's authorization-code + PKCE flow. */
export interface ProviderConfig {
  provider: OauthProvider;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string;
}

// Endpoints + scopes are stable and public; only the client id/secret are environment-specific.
// Google is OIDC (we read the userinfo endpoint rather than validating the id_token signature).
// Discord is plain OAuth2 with `identify email` + GET /users/@me.
const PROVIDER_ENDPOINTS: Record<
  OauthProvider,
  Omit<ProviderConfig, 'clientId' | 'clientSecret'>
> = {
  google: {
    provider: 'google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: 'openid email profile',
  },
  discord: {
    provider: 'discord',
    authorizeUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userinfoUrl: 'https://discord.com/api/users/@me',
    scopes: 'identify email',
  },
};

/** Test-only overrides so specs can flip toggles / enable providers without mutating frozen `env`. */
export interface AuthConfigOverrides {
  passwordLogin?: boolean;
  guest?: boolean;
  redirectBase?: string;
  providers?: Partial<Record<OauthProvider, { clientId: string; clientSecret: string }>>;
  googleMobileClientIds?: string[];
  appleClientIds?: string[];
  appleServicesId?: string;
}

/**
 * The single, injectable source of truth for which auth methods are enabled and how each OAuth
 * provider is configured. Derived from `env` (Nest instantiates it with no args); tests override
 * THIS provider with a `new AuthConfig(overrides)` to exercise enabled/disabled permutations.
 */
@Injectable()
export class AuthConfig {
  readonly passwordLogin: boolean;
  readonly guest: boolean;
  readonly redirectBase: string;
  readonly googleMobileClientIds: string[];
  readonly appleClientIds: string[];
  readonly appleServicesId: string;
  private readonly providers: Record<OauthProvider, ProviderConfig | null>;

  // @Optional so Nest injects `undefined` for the real provider (env-driven); tests pass overrides
  // by constructing `new AuthConfig(overrides)` directly and binding it via `.useValue(...)`.
  constructor(@Optional() overrides?: AuthConfigOverrides) {
    this.passwordLogin = overrides?.passwordLogin ?? env.authPasswordLogin;
    this.guest = overrides?.guest ?? env.authGuest;
    this.redirectBase = (overrides?.redirectBase ?? env.oauthRedirectBase).replace(/\/+$/, '');
    this.googleMobileClientIds = overrides?.googleMobileClientIds ?? env.googleMobileClientIds;
    this.appleClientIds = overrides?.appleClientIds ?? env.appleClientIds;
    this.appleServicesId = overrides?.appleServicesId ?? env.appleServicesId;
    const g = overrides?.providers?.google;
    const d = overrides?.providers?.discord;
    this.providers = {
      google: makeProvider(
        'google',
        g?.clientId ?? env.googleClientId,
        g?.clientSecret ?? env.googleClientSecret,
      ),
      discord: makeProvider(
        'discord',
        d?.clientId ?? env.discordClientId,
        d?.clientSecret ?? env.discordClientSecret,
      ),
    };
  }

  /** The provider's config, or null if it is not fully configured (id + secret both required). */
  provider(p: OauthProvider): ProviderConfig | null {
    return this.providers[p] ?? null;
  }

  /** Sign in with Apple (native credential path): enabled iff at least one audience is configured. */
  get appleEnabled(): boolean {
    return this.appleClientIds.length > 0;
  }

  /** SIWA web/Android redirect flow: enabled iff a Services ID is configured. (The ES256 key
   *  material is checked separately at exchange time — see FetchAppleRedirectClient.) */
  get appleRedirectEnabled(): boolean {
    return this.appleServicesId.length > 0;
  }

  /** The Services ID's registered Return URL — must byte-match Apple's developer console. */
  appleCallbackUrl(): string {
    return `${this.redirectBase}/api/v1/auth/oauth/apple/callback`;
  }

  /** Every audience an Apple identity token may carry: native bundle ids + the web Services ID. */
  appleAudiences(): string[] {
    return [...new Set([...this.appleClientIds, this.appleServicesId].filter(Boolean))];
  }

  /** Every audience a Google ID token may carry: web client id + native app client ids. */
  googleAudiences(): string[] {
    const g = this.providers.google;
    return g ? [g.clientId, ...this.googleMobileClientIds] : [];
  }

  /** The provider `redirect_uri` — must byte-match the value registered in the provider console. */
  callbackUrl(p: OauthProvider): string {
    return `${this.redirectBase}/api/v1/auth/oauth/${p}/callback`;
  }

  /** Where the provider callback sends the browser back to: the SPA's /login/callback route. */
  webCallback(params: { redirect?: string; error?: string }): string {
    const q = new URLSearchParams();
    if (params.redirect) q.set('redirect', params.redirect);
    if (params.error) q.set('error', params.error);
    const qs = q.toString();
    return `${this.redirectBase}/login/callback${qs ? `?${qs}` : ''}`;
  }

  /** Mobile deep-link landing (Universal/App Link): carries a one-time exchange code or error. */
  mobileCallback(params: { code?: string; error?: string }): string {
    const q = new URLSearchParams();
    if (params.code) q.set('code', params.code);
    if (params.error) q.set('error', params.error);
    const qs = q.toString();
    return `${this.redirectBase}/m/callback${qs ? `?${qs}` : ''}`;
  }

  /** The UI hint sent to the web app so it renders only the available entry methods. */
  publicConfig(): {
    passwordLogin: boolean;
    guest: boolean;
    providers: { google: boolean; discord: boolean; apple: boolean; appleRedirect: boolean };
    googleClientId?: string;
  } {
    return {
      passwordLogin: this.passwordLogin,
      guest: this.guest,
      providers: {
        google: !!this.providers.google,
        discord: !!this.providers.discord,
        apple: this.appleEnabled,
        // The browser/Android flow is gated separately: the credential path (`apple`) works with
        // audiences alone, the redirect flow additionally needs the Services ID.
        appleRedirect: this.appleRedirectEnabled,
      },
      ...(this.providers.google ? { googleClientId: this.providers.google.clientId } : {}),
    };
  }
}

const makeProvider = (
  provider: OauthProvider,
  clientId: string,
  clientSecret: string,
): ProviderConfig | null =>
  clientId && clientSecret ? { ...PROVIDER_ENDPOINTS[provider], clientId, clientSecret } : null;
