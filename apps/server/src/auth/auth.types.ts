export type Locale = 'zh-Hant' | 'en';

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
  email?: string;
}

export interface IssuedAuth {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}
