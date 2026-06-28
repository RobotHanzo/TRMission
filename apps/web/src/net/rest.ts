// Typed REST client for the control plane. The access token lives in memory; the
// refresh token is an httpOnly cookie sent automatically (credentials: 'include').
// A 401 triggers one silent refresh + retry.
export type Theme = 'system' | 'light' | 'dark';
export interface UserPreferences {
  theme: Theme;
  colorBlind: boolean;
}
export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  locale: 'zh-Hant' | 'en';
  preferences: UserPreferences;
  email?: string;
}
export interface AuthResult {
  user: PublicUser;
  accessToken: string;
}
export type BotDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface RoomMember {
  userId: string;
  displayName: string;
  isGuest: boolean;
  seat: number;
  ready: boolean;
  isBot?: boolean;
  difficulty?: BotDifficulty;
}
export interface RoomView {
  code: string;
  hostId: string;
  status: 'LOBBY' | 'STARTED' | 'CLOSED';
  maxPlayers: number;
  members: RoomMember[];
  gameId?: string;
}
export interface TicketResult {
  gameId: string;
  ticket: string;
}
export interface MatchSummary {
  _id: string;
  players: { userId: string; seat: number }[];
  winners: string[];
  completedAt: string;
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
  guest: (displayName?: string) =>
    req<AuthResult>('POST', '/auth/guest', { displayName }).then(captureToken),
  login: (email: string, password: string) =>
    req<AuthResult>('POST', '/auth/login', { email, password }).then(captureToken),
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

  history: () => req<MatchSummary[]>('GET', '/history'),
};
