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

/**
 * Signed, short-lived OAuth `state`. It survives the cross-site round-trip to the provider (where
 * cookies under `/api/v1/auth` are not sent), so anything the callback needs — the post-login
 * redirect target, the CSRF nonce (double-submitted against the `trm_oauth` cookie), the PKCE
 * verifier, and the guest id to upgrade in place — is carried inside it. The signature makes it
 * unforgeable; the nonce cookie binds it to the browser that started the flow.
 */
export interface OauthStatePayload {
  kind: 'oauth-state';
  provider: 'google' | 'discord';
  redirect: string;
  nonce: string;
  codeVerifier: string;
  guestUserId?: string;
}

export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  preferences: UserPreferences;
  email?: string;
  avatarUrl?: string;
}

export interface IssuedAuth {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}
