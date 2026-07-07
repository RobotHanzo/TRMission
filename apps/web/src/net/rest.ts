// Typed REST client for the control plane. The access token lives in memory; the
// refresh token is an httpOnly cookie sent automatically (credentials: 'include').
// A 401 triggers one silent refresh + retry.
import type { EventsMode, UserFeature } from '@trm/shared';

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
}
/** Which sign-in methods the server has enabled — drives what the login screen renders. */
export interface AuthConfig {
  passwordLogin: boolean;
  guest: boolean;
  providers: { google: boolean; discord: boolean };
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
export interface RoomSpectator {
  userId: string;
  displayName: string;
  isGuest: boolean;
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
  spectators: RoomSpectator[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
  chat: RoomChatEntry[];
}
export interface TicketResult {
  gameId: string;
  ticket: string;
}
export interface HistoryPlayer {
  userId: string;
  seat: number;
  displayName?: string;
}
export interface MatchSummary {
  gameId: string;
  players: HistoryPlayer[];
  winners: string[];
  completedAt: string;
  role: 'player' | 'spectator';
  finalScores: unknown;
  replayable: boolean;
}
export interface ReplayPlayerMeta extends HistoryPlayer {
  isBot?: boolean;
  difficulty?: BotDifficulty;
}
/** Who may fetch a replay: participants only, or anyone holding the link. */
export type ReplayVisibility = 'private' | 'link';
/** actions stay `unknown[]` here so the eager bundle never imports @trm/engine types;
 *  the lazy replay feature narrows them to engine `Action[]`. */
export interface ReplayPayload {
  gameId: string;
  config: {
    seed: string | number;
    players: { id: string; seat: number }[];
    contentHash: string;
    ruleParams?: Record<string, unknown>;
    shuffleTurnOrder?: boolean;
  };
  engineVersion: number;
  schemaVersion: number;
  actions: unknown[];
  players: ReplayPlayerMeta[];
  winners: string[];
  completedAt: string;
  finalDigest?: string;
  visibility: ReplayVisibility;
  /** True when the signed-in viewer is a seated player of this game. */
  canConfigureVisibility: boolean;
}
/** The ticket-authorized maintainer replay payload — no normal auth involved, the ticket minted
 *  by the dashboard is the sole authority. Covers COMPLETED and TERMINATED games alike. */
export interface AdminReplayPayload {
  gameId: string;
  config: ReplayPayload['config'];
  engineVersion: number;
  schemaVersion: number;
  actions: unknown[];
  status: 'COMPLETED' | 'TERMINATED';
  players: ReplayPlayerMeta[];
  winners?: string[];
  completedAt?: string;
  terminatedAt?: string;
  terminatedBy?: string;
  terminatedReason?: string;
  finalDigest?: string;
}

// --- custom maps (builder + shared/cloned + published content by hash) ---
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
  /** Signed curve-apex deviation override (board units); absent = automatic bow. */
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
export interface MapDraft {
  cities: CityDraft[];
  routes: RouteDraft[];
  tickets: TicketDraft[];
  geography?: MapGeographyDraft;
  rules?: MapRulesDraft;
}
export interface MapSummary {
  id: string;
  nameZh: string;
  nameEn: string;
  revision: number;
  shareCode?: string;
  updatedAt: string;
}
export interface MapDetail extends MapSummary {
  ownerId: string;
  draft: MapDraft;
}
export interface SharedMapView {
  nameZh: string;
  nameEn: string;
  draft: MapDraft;
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

// Single-flight: a refresh token may be rotated only once, so concurrent 401s (e.g. two
// `me()` probes racing on reload — React StrictMode double-invokes effects) must share one
// rotation. A second, independent rotation of the same token trips the server's reuse
// detection and burns the whole session family, logging the user out.
let refreshing: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
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
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(path, { ...init, headers, credentials: 'include' });
  if (res.status !== 401 || !(await tryRefresh())) return res;
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set('Content-Type', 'application/json');
  if (accessToken) retryHeaders.set('Authorization', `Bearer ${accessToken}`);
  return fetch(path, { ...init, headers: retryHeaders, credentials: 'include' });
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await raw(`/api/v1${path}`, {
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

function captureToken(r: AuthResult): AuthResult {
  setAccessToken(r.accessToken);
  onToken?.(r.accessToken);
  return r;
}

export const api = {
  config: () => req<AuthConfig>('GET', '/auth/config'),
  guest: (displayName?: string) =>
    req<AuthResult>('POST', '/auth/guest', { displayName }).then(captureToken),
  login: (email: string, password: string) =>
    req<AuthResult>('POST', '/auth/login', { email, password }).then(captureToken),
  googleCredential: (credential: string) =>
    req<AuthResult>('POST', '/auth/oauth/google/credential', { credential }).then(captureToken),
  register: (email: string, password: string, displayName: string) =>
    req<AuthResult>('POST', '/auth/register', { email, password, displayName }).then(captureToken),
  upgrade: (email: string, password: string) =>
    req<AuthResult>('POST', '/auth/upgrade', { email, password }).then(captureToken),
  me: () => req<PublicUser>('GET', '/auth/me'),
  updatePreferences: (prefs: UserPreferences) =>
    req<PublicUser>('PATCH', '/auth/me/preferences', prefs),
  logout: () => req<void>('POST', '/auth/logout').then(() => setAccessToken(null)),

  createRoom: (maxPlayers?: number) => req<RoomView>('POST', '/rooms', { maxPlayers }),
  getRoom: (code: string) => req<RoomView>('GET', `/rooms/${code}`),
  joinRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/join`),
  leaveRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/leave`),
  setReady: (code: string, ready: boolean) =>
    req<RoomView>('POST', `/rooms/${code}/ready`, { ready }),
  addBot: (code: string, difficulty: BotDifficulty) =>
    req<RoomView>('POST', `/rooms/${code}/bots`, { difficulty }),
  removeBot: (code: string, botId: string) =>
    req<RoomView>('POST', `/rooms/${code}/bots/${encodeURIComponent(botId)}/remove`),
  kickPlayer: (code: string, userId: string) =>
    req<RoomView>('POST', `/rooms/${code}/kick/${encodeURIComponent(userId)}`),
  startRoom: (code: string) => req<TicketResult>('POST', `/rooms/${code}/start`),
  getTicket: (code: string) => req<TicketResult>('POST', `/rooms/${code}/ticket`),
  getPublicRooms: () => req<RoomView[]>('GET', '/rooms/public'),
  /** Rooms the signed-in user is currently seated in (lobby or live game) — the rejoin banner. */
  getMyRooms: () => req<RoomView[]>('GET', '/rooms/mine'),
  updateRoomSettings: (code: string, patch: Partial<RoomSettings>) =>
    req<RoomView>('PATCH', `/rooms/${code}/settings`, patch),
  spectate: (code: string) => req<TicketResult>('POST', `/rooms/${code}/spectate`),
  watchRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/watch`),
  rejoinRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/rejoin`),
  voteRematch: (code: string, wantsRematch: boolean) =>
    req<RoomView>('POST', `/rooms/${code}/rematch-vote`, { wantsRematch }),
  sendRoomChat: (code: string, presetId: string) =>
    req<RoomView>('POST', `/rooms/${code}/chat`, { presetId }),
  rematch: (code: string) => req<RoomView>('POST', `/rooms/${code}/rematch`),

  history: () => req<MatchSummary[]>('GET', '/history'),
  replay: (gameId: string) =>
    req<ReplayPayload>('GET', `/history/${encodeURIComponent(gameId)}/replay`),
  setReplayVisibility: (gameId: string, visibility: ReplayVisibility) =>
    req<{ visibility: ReplayVisibility }>(
      'PATCH',
      `/history/${encodeURIComponent(gameId)}/visibility`,
      { visibility },
    ),
  adminReplay: (gameId: string, ticket: string) =>
    req<AdminReplayPayload>(
      'GET',
      `/history/${encodeURIComponent(gameId)}/admin-replay?ticket=${encodeURIComponent(ticket)}`,
    ),

  listMaps: () => req<MapSummary[]>('GET', '/maps'),
  createMap: (nameZh: string, nameEn: string) =>
    req<MapDetail>('POST', '/maps', { nameZh, nameEn }),
  getMap: (id: string) => req<MapDetail>('GET', `/maps/${encodeURIComponent(id)}`),
  updateMap: (id: string, patch: { nameZh?: string; nameEn?: string; draft?: MapDraft }) =>
    req<MapDetail>('PUT', `/maps/${encodeURIComponent(id)}`, patch),
  deleteMap: (id: string) => req<void>('DELETE', `/maps/${encodeURIComponent(id)}`),
  shareMap: (id: string) =>
    req<{ shareCode: string }>('POST', `/maps/${encodeURIComponent(id)}/share`),
  unshareMap: (id: string) => req<void>('DELETE', `/maps/${encodeURIComponent(id)}/share`),
  peekSharedMap: (code: string) =>
    req<SharedMapView>('GET', `/maps/shared/${encodeURIComponent(code)}`),
  cloneSharedMap: (code: string) =>
    req<MapDetail>('POST', `/maps/shared/${encodeURIComponent(code)}/clone`),
  mapContent: (hash: string) =>
    req<MapContentDto>('GET', `/maps/content/${encodeURIComponent(hash)}`),
};
