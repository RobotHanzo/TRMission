export type Locale = 'zh-Hant' | 'en';
export type Theme = 'system' | 'light' | 'dark';

/** Per-account display preferences (synced for registered users; guests use localStorage). */
export interface UserPreferences {
  theme: Theme;
  colorBlind: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = { theme: 'system', colorBlind: false };

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

export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  locale: Locale;
  preferences: UserPreferences;
  email?: string;
}

export interface IssuedAuth {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}
