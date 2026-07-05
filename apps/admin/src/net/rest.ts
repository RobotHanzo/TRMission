// Typed REST client for the maintainer dashboard — a trimmed copy of the game web
// app's proven core (in-memory access token, httpOnly refresh cookie, single-flight
// 401→refresh→retry) plus the /dashboard endpoints. Same origin as the game, so a
// session established in either app restores in the other.
import type { DashboardPermission, DashboardRole, UserFeature } from '@trm/shared';

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
  };
}

export interface UserRow {
  id: string;
  displayName: string;
  email?: string;
  isGuest: boolean;
  avatarUrl?: string;
  oauthProviders: string[];
  features: UserFeature[];
  createdAt: string;
  disabledAt?: string;
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

export type UsersPage = { users: UserRow[]; nextCursor: string | null };
export type GamesPage = { games: GameRow[]; nextCursor: string | null };
export type RoomsPage = { rooms: RoomRow[]; nextCursor: string | null };
export type AuditPage = { entries: AuditEntry[]; nextCursor: string | null };

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
  listFeaturedUsers: () => req<{ users: UserRow[] }>('GET', '/dashboard/users/features'),

  listGames: (opts: { status?: string; cursor?: string } = {}) =>
    req<GamesPage>('GET', `/dashboard/games${qs(opts)}`),
  getGame: (id: string) => req<GameDetail>('GET', `/dashboard/games/${encodeURIComponent(id)}`),
  getGameLog: (id: string) =>
    req<{ gameId: string; entries: GameLogEntry[] }>(
      'GET',
      `/dashboard/games/${encodeURIComponent(id)}/log`,
    ),
  terminateGame: (id: string, reason?: string) =>
    req<GameDetail>('POST', `/dashboard/games/${encodeURIComponent(id)}/terminate`, { reason }),

  listRooms: (opts: { status?: string; cursor?: string } = {}) =>
    req<RoomsPage>('GET', `/dashboard/rooms${qs(opts)}`),
  closeRoom: (code: string, reason?: string) =>
    req<RoomRow>('POST', `/dashboard/rooms/${encodeURIComponent(code)}/close`, { reason }),

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
};
