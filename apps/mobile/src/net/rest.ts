// Typed REST client for the control plane — a port of apps/web/src/net/rest.ts with two deltas:
//   1. an ABSOLUTE base (API_BASE) — the app is not served same-origin, so there is no cookie jar;
//   2. token-in-body refresh transport (P0-a `x-trm-client: mobile`): the access token lives in
//      memory, the refresh token in the OS keystore (secureStore), and a 401 rotates via the body.
import type { EventsMode, UserFeature } from '@trm/shared';
import { API_BASE } from '../config';
import { clearRefreshToken, getRefreshToken, setRefreshToken } from './secureStore';

export type Theme = 'system' | 'light' | 'dark';
export type Locale = 'zh-Hant' | 'en';
export type BoardLayout = 'rail' | 'tray';
export interface UserPreferences {
  theme: Theme;
  colorBlind: boolean;
  locale: Locale;
  boardLayout: BoardLayout;
}
export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  preferences: UserPreferences;
  /** Per-account gated features granted from the maintainer dashboard. */
  features: UserFeature[];
  email?: string;
  avatarUrl?: string;
}
export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  /** Present iff the client sent `x-trm-client: mobile` — persisted to the keystore. */
  refreshToken?: string;
}
/** Which sign-in methods the server has enabled — drives what the login screen renders. */
export interface AuthConfig {
  passwordLogin: boolean;
  guest: boolean;
  providers: { google: boolean; discord: boolean; apple: boolean };
  googleClientId?: string;
}
export type OauthProvider = 'google' | 'discord';
export type BotDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface RoomMember {
  userId: string;
  displayName: string;
  isGuest: boolean;
  seat: number;
  ready: boolean;
  isBot?: boolean;
  difficulty?: BotDifficulty;
  wantsRematch?: boolean;
}
export type RoomVisibility = 'PUBLIC' | 'INVITE_ONLY';
export type MapSelector =
  | { source: 'official'; mapId: string }
  | { source: 'custom'; customMapId: string };
export interface RoomSettings {
  unlimitedStationBorrow: boolean;
  secondDrawAfterBlindRainbow: boolean;
  noUnfinishedTicketPenalty: boolean;
  doubleRouteSingleFor23: boolean;
  allowSpectating: boolean;
  visibility: RoomVisibility;
  map: MapSelector;
  eventsMode: EventsMode;
}
export interface RoomChatEntry {
  userId: string;
  presetId: string;
  ts: number;
}
export interface RoomView {
  code: string;
  hostId: string;
  status: 'LOBBY' | 'STARTED' | 'CLOSED';
  maxPlayers: number;
  members: RoomMember[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
  chat: RoomChatEntry[];
}
export interface TicketResult {
  gameId: string;
  ticket: string;
}
export interface MobileCarryResult {
  code: string;
}

// --- custom-map content (resolved by hash for a custom-map game) ---
export interface CityDraft {
  id: string;
  nameZh: string;
  nameEn: string;
  x: number;
  y: number;
  region: string;
  isIsland: boolean;
}
export interface RouteDraft {
  id: string;
  a: string;
  b: string;
  color: string;
  length: number;
  doubleGroup?: string;
  ferryLocos: number;
  isTunnel: boolean;
  bow?: number;
}
export interface TicketDraft {
  id: string;
  a: string;
  b: string;
  value: number;
  deck: 'LONG' | 'SHORT';
}
export interface MapGeographyDraft {
  baseView: { x: number; y: number; w: number; h: number };
  land: readonly (readonly (readonly [number, number])[])[];
  crop: { lonMin: number; lonMax: number; latMin: number; latMax: number };
}
export interface MapRulesDraft {
  trainCarsStart?: number;
  stationsPerPlayer?: number;
  longestPathBonus?: number;
  stationBonus?: number;
  initialLongOffer?: number;
  initialShortOffer?: number;
  ticketDrawCount?: number;
}
export interface MapContentDto {
  meta: { mapId: string; version: number; nameZh: string; nameEn: string };
  cities: CityDraft[];
  routes: RouteDraft[];
  tickets: TicketDraft[];
  geography?: MapGeographyDraft;
  rules?: MapRulesDraft;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onToken: ((t: string | null) => void) | undefined;

export const setAccessToken = (t: string | null): void => {
  accessToken = t;
};
export const setOnTokenChange = (cb: (t: string | null) => void): void => {
  onToken = cb;
};

const MOBILE_CLIENT_HEADER = 'x-trm-client';

/** Common request headers — JSON, the mobile-client marker, and the in-memory access token. */
function headers(existing?: HeadersInit): Headers {
  const h = new Headers(existing);
  h.set('Content-Type', 'application/json');
  h.set(MOBILE_CLIENT_HEADER, 'mobile');
  if (accessToken) h.set('Authorization', `Bearer ${accessToken}`);
  return h;
}

// Single-flight: a refresh token may be rotated only once, so concurrent 401s must share one
// rotation. A second independent rotation of the same token trips the server's reuse detection and
// burns the whole session family, logging the user out.
let refreshing: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const token = await getRefreshToken();
      if (!token) return false; // no keystore token → nothing to rotate (fresh install / signed out)
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string; refreshToken?: string };
      accessToken = data.accessToken;
      // Body-in → body-out: persist the rotated refresh token (the mobile analogue of the cookie).
      if (data.refreshToken) await setRefreshToken(data.refreshToken);
      onToken?.(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function raw(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: headers(init.headers) });
  if (res.status !== 401 || !(await tryRefresh())) return res;
  // Rebuild headers so the retry carries the freshly-rotated access token.
  return fetch(`${API_BASE}${path}`, { ...init, headers: headers(init.headers) });
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await raw(path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, detail.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Capture an issuance result: access token to memory, refresh token to the keystore. */
async function captureAuth(r: AuthResult): Promise<AuthResult> {
  setAccessToken(r.accessToken);
  if (r.refreshToken) await setRefreshToken(r.refreshToken);
  onToken?.(r.accessToken);
  return r;
}

export const api = {
  config: (): Promise<AuthConfig> => req<AuthConfig>('GET', '/auth/config'),
  guest: (displayName?: string): Promise<AuthResult> =>
    req<AuthResult>('POST', '/auth/guest', { displayName }).then(captureAuth),
  login: (email: string, password: string): Promise<AuthResult> =>
    req<AuthResult>('POST', '/auth/login', { email, password }).then(captureAuth),
  register: (email: string, password: string, displayName: string): Promise<AuthResult> =>
    req<AuthResult>('POST', '/auth/register', { email, password, displayName }).then(captureAuth),
  upgrade: (email: string, password: string): Promise<AuthResult> =>
    req<AuthResult>('POST', '/auth/upgrade', { email, password }).then(captureAuth),
  // The stored guest refresh token upgrades that guest in place (the mobile analogue of the cookie
  // web sends). Absent on a fresh install → the server just signs the OAuth identity in.
  googleCredential: async (credential: string): Promise<AuthResult> => {
    const refreshToken = (await getRefreshToken()) ?? undefined;
    return req<AuthResult>('POST', '/auth/oauth/google/credential', {
      credential,
      refreshToken,
    }).then(captureAuth);
  },
  appleCredential: async (identityToken: string, fullName?: string): Promise<AuthResult> => {
    const refreshToken = (await getRefreshToken()) ?? undefined;
    return req<AuthResult>('POST', '/auth/oauth/apple/credential', {
      identityToken,
      fullName,
      refreshToken,
    }).then(captureAuth);
  },
  mobileCarry: (): Promise<MobileCarryResult> =>
    req<MobileCarryResult>('POST', '/auth/mobile/carry'),
  mobileExchange: (code: string): Promise<AuthResult> =>
    req<AuthResult>('POST', '/auth/mobile/exchange', { code }).then(captureAuth),
  me: (): Promise<PublicUser> => req<PublicUser>('GET', '/auth/me'),
  updatePreferences: (prefs: UserPreferences): Promise<PublicUser> =>
    req<PublicUser>('PATCH', '/auth/me/preferences', prefs),
  deleteAccount: (appleAuthorizationCode?: string): Promise<void> =>
    req<void>('DELETE', '/auth/me', { appleAuthorizationCode }),
  logout: async (): Promise<void> => {
    const refreshToken = (await getRefreshToken()) ?? undefined;
    await req<void>('POST', '/auth/logout', { refreshToken });
    setAccessToken(null);
    await clearRefreshToken();
  },

  getRoom: (code: string): Promise<RoomView> => req<RoomView>('GET', `/rooms/${code}`),
  /** Rooms the signed-in user is currently seated in (lobby or live game). */
  getMyRooms: (): Promise<RoomView[]> => req<RoomView[]>('GET', '/rooms/mine'),
  getTicket: (code: string): Promise<TicketResult> =>
    req<TicketResult>('POST', `/rooms/${code}/ticket`),
  mapContent: (hash: string): Promise<MapContentDto> =>
    req<MapContentDto>('GET', `/maps/content/${encodeURIComponent(hash)}`),

  registerDevice: (platform: 'ios' | 'android', token: string): Promise<void> =>
    req<void>('POST', '/me/devices', { platform, token }),
  removeDevice: (token: string): Promise<void> => req<void>('DELETE', '/me/devices', { token }),
};

export { req };
