// Typed REST client for the maintainer dashboard — a trimmed copy of the game web
// app's proven core (in-memory access token, httpOnly refresh cookie, single-flight
// 401→refresh→retry) plus the /dashboard endpoints. Same origin as the game, so a
// session established in either app restores in the other.
import type { DashboardPermission, DashboardRole, UserFeature } from '@trm/shared';
import type { MapGeography } from '@trm/map-data';

export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  email?: string;
  avatarUrl?: string;
}
export interface DashboardMe {
  userId: string;
  displayName: string;
  role: DashboardRole;
  permissions: DashboardPermission[];
}

export interface Overview {
  liveGames: { db: number; inMemory: number };
  rooms: { lobby: number; started: number };
  users: { total: number; guests: number; registered: number; disabled: number; new24h: number };
  sessions: { active: number };
  metrics: {
    activeConnections: number;
    commandsTotal: number;
    rejectionsTotal: number;
    rejectionsByCode: Record<string, number>;
    leaksBlocked: number;
    residentMemoryBytes: number;
    commandApplyAvgMs: number | null;
  };
  versions: {
    engineVersion: number;
    protocolVersion: number;
    contentHash: string;
    uptimeSeconds: number;
    commitHash: string;
  };
}

export interface UserRow {
  id: string;
  displayName: string;
  email?: string;
  isGuest: boolean;
  avatarUrl?: string;
  oauthProviders: string[];
  hasPassword: boolean;
  features: UserFeature[];
  tutorialCompleted: boolean;
  createdAt: string;
  disabledAt?: string;
  guestExpiresAt?: string;
  lastLoginIp?: string;
  lastLoginAt?: string;
}
export interface UserDetail extends UserRow {
  locale?: string;
  disabledBy?: string;
  disabledReason?: string;
  activeSessions: number;
  activeRooms: { code: string; status: string }[];
  history: unknown[];
  isMaintainer: boolean;
}
export type UserFilter = 'all' | 'guests' | 'registered' | 'disabled';

export interface GameRow {
  gameId: string;
  status: string;
  currentSeq: number;
  playerCount: number;
  botCount: number;
  engineVersion: number;
  contentHash: string;
  inMemory: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface GamePlayer {
  id: string;
  seat: number;
  displayName?: string;
  isBot: boolean;
  difficulty?: string;
}
export interface GameDetail {
  gameId: string;
  status: string;
  currentSeq: number;
  engineVersion: number;
  contentHash: string;
  schemaVersion: number;
  inMemory: boolean;
  createdAt: string;
  updatedAt: string;
  seed?: string | number;
  players: GamePlayer[];
  spectators: string[];
  roomCode?: string;
  chat: { playerId: string; ts: string; kind: 'text' | 'preset'; value: string }[];
  terminated?: { at: string; by: string; reason?: string };
}
export interface GameLogEntry {
  seq: number;
  action: unknown;
  stateDigest: string;
  ts: string;
}

export interface RoomRow {
  code: string;
  hostId: string;
  status: string;
  memberCount: number;
  maxPlayers: number;
  visibility: string;
  gameId?: string;
  createdAt: string;
  updatedAt: string;
  members: { userId: string; displayName: string; isBot: boolean; seat: number }[];
}
export interface RoomDetail {
  code: string;
  hostId: string;
  hostName?: string;
  status: string;
  visibility: string;
  maxPlayers: number;
  createdAt: string;
  updatedAt: string;
  gameId?: string;
  gameStatus?: string;
  members: {
    userId: string;
    displayName: string;
    seat: number;
    isBot: boolean;
    isGuest: boolean;
    ready: boolean;
    difficulty?: string;
  }[];
  spectators: { userId: string; displayName: string }[];
  settings: {
    map: { source: 'official' | 'custom'; id: string };
    allowSpectating: boolean;
    eventsMode: string;
    teamCount: number;
    unlimitedStationBorrow: boolean;
    secondDrawAfterBlindRainbow: boolean;
    noUnfinishedTicketPenalty: boolean;
    doubleRouteSingleFor23: boolean;
  };
}

export interface MapAdminRow {
  id: string;
  ownerId: string;
  ownerDisplayName?: string;
  nameZh: string;
  nameEn: string;
  revision: number;
  shared: boolean;
  updatedAt: string;
}
export interface MapAdminDetail extends MapAdminRow {
  createdAt: string;
  shareCode?: string;
  usageCount: number;
  draft: {
    cities: { id: string; x: number; y: number }[];
    routes: { a: string; b: string }[];
    tickets: unknown[];
    geography?: MapGeography;
  };
}
export type MapsPage = { maps: MapAdminRow[]; nextCursor: string | null };

export interface MaintainerRow {
  userId: string;
  role: DashboardRole;
  extraPermissions: DashboardPermission[];
  deniedPermissions: DashboardPermission[];
  permissions: DashboardPermission[];
  grantedBy: string;
  grantedAt: string;
  updatedAt: string;
  dangling: boolean;
  displayName?: string;
  email?: string;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  target?: { type: string; id: string };
  params?: Record<string, unknown>;
  at: string;
}

export interface PurgeRunResult {
  roomsDeleted: number;
  gamesDeleted: number;
  capped: boolean;
}
export interface PurgeStatus {
  autoEnabled: boolean;
  intervalMs: number;
  roomLobbyPurgeHours: number;
  gameLivePurgeHours: number;
  recentRuns: {
    at: string;
    actorName: string;
    roomsDeleted: number;
    gamesDeleted: number;
    capped: boolean;
  }[];
}

export type PushKind = 'your_turn' | 'game_started' | 'game_over' | 'game_paused';
export interface PushStatus {
  enabled: boolean;
}
export interface PushTestResult {
  enabled: boolean;
  deviceCount: number;
  sent: number;
  failed: number;
}

export type ReportStatusFilter = 'open' | 'resolved' | 'all';
export interface ReportRow {
  id: string;
  kind: 'player' | 'map';
  status: 'open' | 'resolved';
  category: string;
  reporterId: string;
  reporterName: string;
  message?: string;
  reportedUserId?: string;
  reportedName?: string;
  gameId?: string;
  roomCode?: string;
  mapId?: string;
  shareCode?: string;
  mapNameZh?: string;
  mapNameEn?: string;
  resolvedByName?: string;
  resolutionNote?: string;
  resolvedAt?: string;
  createdAt: string;
}

export type UsersPage = { users: UserRow[]; nextCursor: string | null };
export type GamesPage = { games: GameRow[]; nextCursor: string | null };
export type RoomsPage = { rooms: RoomRow[]; nextCursor: string | null };
export type AuditPage = { entries: AuditEntry[]; nextCursor: string | null };
export type ReportsPage = { reports: ReportRow[]; nextCursor: string | null };

export interface RatingRow {
  id: string;
  userId: string;
  userDisplayName?: string;
  gameId: string;
  roomId: string;
  stars: number;
  text?: string;
  createdAt: string;
}
export type RatingsPage = {
  ratings: RatingRow[];
  nextCursor: string | null;
  avgStars: number | null;
  totalCount: number;
};

export type LeaderboardScopeKind = 'allTime' | 'season';
export type LeaderboardMetric = 'rating' | 'wins' | 'gamesPlayed';

export interface LeaderboardRow {
  userId: string;
  displayName?: string;
  rank: number;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
}
export type LeaderboardPage = { rows: LeaderboardRow[]; nextCursor: string | null };

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

// Single-flight: a refresh token may be rotated only once; concurrent 401s share one
// rotation or the server's reuse detection burns the whole session family.
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

const qs = (params: Record<string, string | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const api = {
  // Existing auth endpoints (shared with the game app; same cookie). Admin never signs
  // in directly — it only restores a session via the shared refresh cookie (api.me()'s
  // 401→refresh path) or clears one (logout).
  me: () => req<PublicUser>('GET', '/auth/me'),
  logout: () => req<void>('POST', '/auth/logout').then(() => setAccessToken(null)),

  // Dashboard.
  dashboardMe: () => req<DashboardMe>('GET', '/dashboard/me'),
  overview: () => req<Overview>('GET', '/dashboard/overview'),

  listUsers: (opts: { q?: string; filter?: UserFilter; cursor?: string } = {}) =>
    req<UsersPage>('GET', `/dashboard/users${qs(opts)}`),
  getUser: (id: string) => req<UserDetail>('GET', `/dashboard/users/${encodeURIComponent(id)}`),
  disableUser: (id: string, reason?: string) =>
    req<UserDetail>('POST', `/dashboard/users/${encodeURIComponent(id)}/disable`, { reason }),
  enableUser: (id: string) =>
    req<UserDetail>('POST', `/dashboard/users/${encodeURIComponent(id)}/enable`, {}),
  putUserFeatures: (id: string, features: UserFeature[]) =>
    req<UserDetail>('PUT', `/dashboard/users/${encodeURIComponent(id)}/features`, { features }),
  resetUserTutorial: (id: string) =>
    req<UserDetail>('POST', `/dashboard/users/${encodeURIComponent(id)}/tutorial-reset`, {}),
  deleteUser: (id: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/users/${encodeURIComponent(id)}`, { reason }),
  listFeaturedUsers: () => req<{ users: UserRow[] }>('GET', '/dashboard/users/features'),
  getDefaultFeatures: () => req<{ features: UserFeature[] }>('GET', '/dashboard/config/features'),
  putDefaultFeatures: (features: UserFeature[]) =>
    req<{ features: UserFeature[] }>('PUT', '/dashboard/config/features', { features }),

  listGames: (opts: { status?: string; cursor?: string } = {}) =>
    req<GamesPage>('GET', `/dashboard/games${qs(opts)}`),
  getGame: (id: string) => req<GameDetail>('GET', `/dashboard/games/${encodeURIComponent(id)}`),
  getGameLog: (id: string) =>
    req<{ gameId: string; entries: GameLogEntry[] }>(
      'GET',
      `/dashboard/games/${encodeURIComponent(id)}/log`,
    ),
  mintReplayTicket: (id: string) =>
    req<{ ticket: string; expiresIn: string }>(
      'POST',
      `/dashboard/games/${encodeURIComponent(id)}/replay-ticket`,
      {},
    ),
  mintSpectateTicket: (id: string) =>
    req<{ ticket: string; expiresIn: string }>(
      'POST',
      `/dashboard/games/${encodeURIComponent(id)}/spectate-ticket`,
      {},
    ),
  terminateGame: (id: string, reason?: string) =>
    req<GameDetail>('POST', `/dashboard/games/${encodeURIComponent(id)}/terminate`, { reason }),
  deleteGame: (id: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/games/${encodeURIComponent(id)}`, { reason }),

  listRooms: (opts: { status?: string; cursor?: string } = {}) =>
    req<RoomsPage>('GET', `/dashboard/rooms${qs(opts)}`),
  closeRoom: (code: string, reason?: string) =>
    req<RoomRow>('POST', `/dashboard/rooms/${encodeURIComponent(code)}/close`, { reason }),
  transferRoomHost: (code: string, userId: string, reason?: string) =>
    req<RoomRow>(
      'POST',
      `/dashboard/rooms/${encodeURIComponent(code)}/transfer/${encodeURIComponent(userId)}`,
      { reason },
    ),
  deleteRoom: (code: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/rooms/${encodeURIComponent(code)}`, { reason }),
  getRoom: (code: string) => req<RoomDetail>('GET', `/dashboard/rooms/${encodeURIComponent(code)}`),

  listMaintainers: () => req<{ maintainers: MaintainerRow[] }>('GET', '/dashboard/maintainers'),
  putMaintainer: (
    userId: string,
    body: {
      role: DashboardRole;
      extraPermissions?: DashboardPermission[];
      deniedPermissions?: DashboardPermission[];
    },
  ) => req<MaintainerRow>('PUT', `/dashboard/maintainers/${encodeURIComponent(userId)}`, body),
  deleteMaintainer: (userId: string) =>
    req<void>('DELETE', `/dashboard/maintainers/${encodeURIComponent(userId)}`),

  listAudit: (opts: { cursor?: string } = {}) =>
    req<AuditPage>('GET', `/dashboard/audit${qs(opts)}`),

  listRatings: (opts: { cursor?: string } = {}) =>
    req<RatingsPage>('GET', `/dashboard/ratings${qs(opts)}`),
  listLeaderboard: (
    opts: { scope?: LeaderboardScopeKind; metric?: LeaderboardMetric; cursor?: string } = {},
  ) => req<LeaderboardPage>('GET', `/dashboard/leaderboard${qs(opts)}`),
  listReports: (opts: { status?: ReportStatusFilter; cursor?: string } = {}) =>
    req<ReportsPage>('GET', `/dashboard/reports${qs(opts)}`),
  resolveReport: (id: string, note?: string) =>
    req<ReportRow>('POST', `/dashboard/reports/${encodeURIComponent(id)}/resolve`, { note }),

  getPurgeStatus: () => req<PurgeStatus>('GET', '/dashboard/purge/status'),
  runPurge: () => req<PurgeRunResult>('POST', '/dashboard/purge/run', {}),

  getPushStatus: () => req<PushStatus>('GET', '/dashboard/push/status'),
  sendTestPush: (userId: string, kind: PushKind) =>
    req<PushTestResult>('POST', '/dashboard/push/test', { userId, kind }),

  listMaps: (opts: { cursor?: string } = {}) => req<MapsPage>('GET', `/dashboard/maps${qs(opts)}`),
  getMap: (id: string) => req<MapAdminDetail>('GET', `/dashboard/maps/${encodeURIComponent(id)}`),
  deleteMap: (id: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/maps/${encodeURIComponent(id)}`, { reason }),
  unshareMap: (id: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/maps/${encodeURIComponent(id)}/share`, { reason }),
  transferMap: (id: string, newOwnerId: string) =>
    req<MapAdminDetail>('POST', `/dashboard/maps/${encodeURIComponent(id)}/transfer`, {
      newOwnerId,
    }),
};
