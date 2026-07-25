import type { MapFeatureKey, UserFeature } from '@trm/shared';

export type Locale = 'zh-Hant' | 'en';
export type Theme = 'system' | 'light' | 'dark';
export type BoardLayout = 'rail' | 'tray';

/** Per-account display preferences (synced for registered users; guests use localStorage). */
export interface UserPreferences {
  theme: Theme;
  colorBlind: boolean;
  locale: Locale;
  boardLayout: BoardLayout;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  colorBlind: false,
  locale: 'zh-Hant',
  boardLayout: 'rail',
};

/** Shape attached to the request by AccessTokenGuard. */
export interface AuthUser {
  userId: string;
  displayName: string;
  isGuest: boolean;
}

/** Access-token JWT payload. */
export interface JwtPayload {
  kind: 'access';
  sub: string;
  name: string;
  guest: boolean;
  tv: number; // tokenVersion
}

/** ws-game ticket JWT payload (ADR A8). */
export interface WsTicketPayload {
  kind: 'ws-game';
  gameId: string;
  playerId: string;
  seat: number;
}

/** Admin-replay ticket JWT payload — a maintainer's handoff from the dashboard to
 *  apps/web's ticket-authorized replay route. Bypasses membership entirely; the ticket
 *  itself (scoped to one gameId, short-lived) is the sole authority. */
export interface AdminReplayTicketPayload {
  kind: 'admin-replay';
  gameId: string;
  actorId: string;
}

/**
 * Signed, short-lived OAuth `state`. It survives the cross-site round-trip to the provider (where
 * cookies under `/api/v1/auth` are not sent), so anything the callback needs — the post-login
 * redirect target, the CSRF nonce (double-submitted against the `trm_oauth` cookie), an opaque
 * handle to the server-held PKCE verifier, and the guest id to upgrade in place — is carried
 * inside it. The signature makes it unforgeable; the nonce cookie binds it to the browser that
 * started the flow. A JWT payload is base64url, not confidential, so the PKCE verifier itself is
 * never placed here (F34) — it lives server-side in `OauthPkceRepo`, keyed by this handle.
 */
export interface OauthStatePayload {
  kind: 'oauth-state';
  provider: 'google' | 'discord' | 'apple';
  redirect: string;
  nonce: string;
  /** Opaque handle into `OauthPkceRepo` — absent for Apple, which ignores PKCE entirely
   *  (identity comes from the id_token, not a code exchanged with a verifier). */
  codeVerifierHandle?: string;
  guestUserId?: string;
  /** Set when the flow started with ?client=mobile: the callback hands off via /m/callback. */
  mobile?: boolean;
  /**
   * App-binding PKCE-style challenge (F16 hardening) — distinct from `codeVerifier` above, which
   * only secures the server's own exchange with the OAuth provider. This is a SHA-256 hex digest
   * the MOBILE APP generated before starting this flow (`?challenge=` on `/oauth/:provider/start`);
   * it is carried through to the minted exchange code so `POST /auth/mobile/exchange` can demand
   * the matching verifier back, binding redemption to the app instance that started the flow
   * rather than to whoever merely catches the `trmission://` deep link.
   */
  mobileChallenge?: string;
}

export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  preferences: UserPreferences;
  /** Per-account gated features (dashboard-granted). Empty for everyone by default. */
  features: UserFeature[];
  /** Whether this account has reached the guided tutorial's finale. */
  tutorialCompleted: boolean;
  /** Map-feature intros already shown to this account (one-shot per feature). */
  seenFeatureIntros: MapFeatureKey[];
  email?: string;
  avatarUrl?: string;
}

export interface IssuedAuth {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}
