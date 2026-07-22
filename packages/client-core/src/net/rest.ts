// Typed REST client for the control plane, shared by both apps. The access token always lives in
// memory; everything platform-specific — base URL, extra headers, and above all the refresh-token
// TRANSPORT (web: httpOnly cookie + credentials:'include'; mobile: token-in-body against the OS
// keystore) — is injected through a RestTransport. A 401 triggers ONE silent refresh + retry,
// single-flighted: a refresh token may be rotated only once, so concurrent 401s (e.g. two `me()`
// probes racing on reload) must share one rotation — a second independent rotation of the same
// token trips the server's reuse detection and burns the whole session family.
import type {
  AdminReplayPayload,
  AdminSpectatePayload,
  AuthConfig,
  AuthResult,
  BlockList,
  BotDifficulty,
  MapContentDto,
  MapDetail,
  MapDraft,
  MapSummary,
  MatchSummary,
  MobileCarryResult,
  OfficialMapSummary,
  PracticeResult,
  PublicUser,
  RatingResult,
  ReplayPayload,
  ReplayVisibility,
  ReportCategory,
  RoomSettings,
  RoomView,
  SharedMapView,
  TicketResult,
  UserPreferences,
} from './restTypes';
import type { MapFeatureKey } from '@trm/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The platform seam. Everything else in this file is identical on web and mobile. */
export interface RestTransport {
  /** Prepended to `/api/v1${path}` — `''` on web (same-origin), an absolute origin on mobile. */
  baseUrl: string;
  /** fetch credentials mode — `'include'` on web so the httpOnly refresh cookie rides along.
   *  (Literal union rather than DOM's RequestCredentials: this file also compiles under node/RN
   *  lib settings, which don't declare that name.) */
  credentials?: 'include' | 'omit' | 'same-origin';
  /** Extra headers stamped on every request (mobile: `x-trm-client: mobile`). */
  extraHeaders?: Record<string, string>;
  /**
   * Rotate the refresh token and return the fresh tokens, or null if there is nothing to rotate /
   * the rotation was rejected. The transport owns persisting a rotated refresh token (mobile
   * keystore); web's cookie rotates server-side.
   */
  refresh(): Promise<{ accessToken: string } | null>;
  /** Persist a refresh token delivered in an issuance body (mobile keystore; no-op on web). */
  persistRefreshToken?(token: string): Promise<void>;
  /** Read the persisted refresh token for endpoints that send it in the body (mobile only). */
  readRefreshToken?(): Promise<string | null>;
  /** Clear the persisted refresh token on logout (mobile keystore; web's cookie dies server-side). */
  clearRefreshToken?(): Promise<void>;
}

export interface RestClient {
  api: RestApi;
  setAccessToken(t: string | null): void;
  setOnTokenChange(cb: (t: string | null) => void): void;
  /** The raw JSON request helper, for app-local endpoints not in the shared surface. */
  req<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export type RestApi = ReturnType<typeof buildApi>;

export function createRestClient(transport: RestTransport): RestClient {
  let accessToken: string | null = null;
  let onToken: ((t: string | null) => void) | undefined;
  const setAccessToken = (t: string | null): void => {
    accessToken = t;
  };

  let refreshing: Promise<boolean> | null = null;
  function tryRefresh(): Promise<boolean> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const rotated = await transport.refresh();
        if (!rotated) return false;
        accessToken = rotated.accessToken;
        onToken?.(rotated.accessToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function headers(existing?: RequestInit['headers']): Headers {
    const h = new Headers(existing);
    h.set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(transport.extraHeaders ?? {})) h.set(k, v);
    if (accessToken) h.set('Authorization', `Bearer ${accessToken}`);
    return h;
  }

  async function raw(path: string, init: RequestInit): Promise<Response> {
    const url = `${transport.baseUrl}${path}`;
    const opts = transport.credentials ? { credentials: transport.credentials } : {};
    const res = await fetch(url, { ...init, ...opts, headers: headers(init.headers) });
    if (res.status !== 401 || !(await tryRefresh())) return res;
    // Rebuild headers so the retry carries the freshly-rotated access token.
    return fetch(url, { ...init, ...opts, headers: headers(init.headers) });
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

  /** Capture an issuance result: access token to memory, refresh token to the transport's store. */
  async function capture(r: AuthResult): Promise<AuthResult> {
    setAccessToken(r.accessToken);
    if (r.refreshToken) await transport.persistRefreshToken?.(r.refreshToken);
    onToken?.(r.accessToken);
    return r;
  }

  const api = buildApi(req, capture, transport, setAccessToken);
  return {
    api,
    req,
    setAccessToken,
    setOnTokenChange: (cb) => {
      onToken = cb;
    },
  };
}

// The full endpoint surface — the union of both apps' historical clients. Endpoints that only one
// platform exercises today (e.g. mobileCarry, push devices on mobile; the builder's map CRUD on
// web) are still defined for both: the server is the same and the unused ones simply aren't called.
function buildApi(
  req: <T>(method: string, path: string, body?: unknown) => Promise<T>,
  capture: (r: AuthResult) => Promise<AuthResult>,
  transport: RestTransport,
  setAccessToken: (t: string | null) => void,
) {
  return {
    // ── auth ────────────────────────────────────────────────────────────────
    config: () => req<AuthConfig>('GET', '/auth/config'),
    guest: (displayName?: string) =>
      req<AuthResult>('POST', '/auth/guest', { displayName }).then(capture),
    login: (email: string, password: string) =>
      req<AuthResult>('POST', '/auth/login', { email, password }).then(capture),
    register: (email: string, password: string, displayName: string) =>
      req<AuthResult>('POST', '/auth/register', { email, password, displayName }).then(capture),
    upgrade: (email: string, password: string) =>
      req<AuthResult>('POST', '/auth/upgrade', { email, password }).then(capture),
    // A stored refresh token rides along so a guest upgrades in place (mobile keystore; web's
    // cookie covers the same server-side, and `readRefreshToken` is absent there).
    googleCredential: async (credential: string) =>
      req<AuthResult>('POST', '/auth/oauth/google/credential', {
        credential,
        refreshToken: (await transport.readRefreshToken?.()) ?? undefined,
      }).then(capture),
    appleCredential: async (identityToken: string, fullName?: string) =>
      req<AuthResult>('POST', '/auth/oauth/apple/credential', {
        identityToken,
        fullName,
        refreshToken: (await transport.readRefreshToken?.()) ?? undefined,
      }).then(capture),
    mobileCarry: () => req<MobileCarryResult>('POST', '/auth/mobile/carry'),
    mobileExchange: (code: string) =>
      req<AuthResult>('POST', '/auth/mobile/exchange', { code }).then(capture),
    me: () => req<PublicUser>('GET', '/auth/me'),
    updatePreferences: (prefs: UserPreferences) =>
      req<PublicUser>('PATCH', '/auth/me/preferences', prefs),
    markTutorialCompleted: () => req<PublicUser>('POST', '/auth/me/tutorial-completed'),
    markFeatureIntroSeen: (feature: MapFeatureKey) =>
      req<PublicUser>('POST', '/auth/me/feature-intros', { feature }),
    logout: async (): Promise<void> => {
      const refreshToken = (await transport.readRefreshToken?.()) ?? undefined;
      await req<void>('POST', '/auth/logout', refreshToken ? { refreshToken } : undefined);
      setAccessToken(null);
      await transport.clearRefreshToken?.();
    },
    /** Irreversible. 204 on success; 409 while the account still holds dashboard access. */
    deleteAccount: (appleAuthorizationCode?: string) =>
      req<void>('DELETE', '/auth/me', { appleAuthorizationCode }).then(() => setAccessToken(null)),

    // ── rooms / lobby ───────────────────────────────────────────────────────
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
    /** Host-only: reseat the table. Since team membership is `seat % teamCount`, this IS the team
     *  picker. `userIds` must be a permutation of the current members; human ready flags reset. */
    reseatRoom: (code: string, userIds: readonly string[]) =>
      req<RoomView>('POST', `/rooms/${code}/seats`, { userIds }),
    /** Self-join mode: move yourself onto `team` (0-indexed). No-op if you're already there. */
    joinTeam: (code: string, team: number) =>
      req<RoomView>('POST', `/rooms/${code}/team`, { team }),
    startRoom: (code: string) => req<TicketResult>('POST', `/rooms/${code}/start`),
    startPractice: () => req<PracticeResult>('POST', '/rooms/practice'),
    getTicket: (code: string) => req<TicketResult>('POST', `/rooms/${code}/ticket`),
    getPublicRooms: () => req<RoomView[]>('GET', '/rooms/public'),
    /** Rooms the signed-in user is currently seated in (lobby or live game) — the rejoin banner. */
    getMyRooms: () => req<RoomView[]>('GET', '/rooms/mine'),
    updateRoomSettings: (code: string, patch: Partial<RoomSettings>) =>
      req<RoomView>('PATCH', `/rooms/${code}/settings`, patch),
    spectate: (code: string) => req<TicketResult>('POST', `/rooms/${code}/spectate`),
    watchRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/watch`),
    rejoinRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/rejoin`),
    transferOwnership: (code: string, userId: string) =>
      req<RoomView>('POST', `/rooms/${code}/transfer/${encodeURIComponent(userId)}`),
    closeRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/close`),
    voteRematch: (code: string, wantsRematch: boolean) =>
      req<RoomView>('POST', `/rooms/${code}/rematch-vote`, { wantsRematch }),
    voteEnd: (code: string, wantsEnd: boolean) =>
      req<RoomView>('POST', `/rooms/${code}/end-vote`, { wantsEnd }),
    sendRoomChat: (code: string, payload: { presetId: string } | { text: string }) =>
      req<RoomView>('POST', `/rooms/${code}/chat`, payload),
    rematch: (code: string) => req<RoomView>('POST', `/rooms/${code}/rematch`),
    submitRating: (payload: { gameId: string; roomId: string; stars: number; text?: string }) =>
      req<RatingResult>('POST', '/ratings', payload),

    // ── history / replay ────────────────────────────────────────────────────
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
    adminSpectate: (gameId: string, ticket: string) =>
      req<AdminSpectatePayload>(
        'GET',
        `/history/${encodeURIComponent(gameId)}/admin-spectate?ticket=${encodeURIComponent(ticket)}`,
      ),

    // ── custom maps ─────────────────────────────────────────────────────────
    listMaps: () => req<MapSummary[]>('GET', '/maps'),
    listOfficialMaps: () => req<OfficialMapSummary[]>('GET', '/maps/official'),
    forkOfficialMap: (mapId: string) =>
      req<MapDetail>('POST', `/maps/fork/${encodeURIComponent(mapId)}`),
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
    reportSharedMap: (shareCode: string, category: ReportCategory, message?: string) =>
      req<{ id: string }>('POST', '/reports/map', { shareCode, category, message }),
    cloneSharedMap: (code: string) =>
      req<MapDetail>('POST', `/maps/shared/${encodeURIComponent(code)}/clone`),
    mapContent: (hash: string) =>
      req<MapContentDto>('GET', `/maps/content/${encodeURIComponent(hash)}`),

    // ── push devices + UGC compliance (Apple 1.2 / Play UGC) ────────────────
    registerDevice: (platform: 'ios' | 'android', token: string) =>
      req<void>('POST', '/me/devices', { platform, token }),
    removeDevice: (token: string) => req<void>('DELETE', '/me/devices', { token }),
    myBlocks: () => req<BlockList>('GET', '/me/blocks'),
    blockUser: (userId: string) => req<void>('PUT', `/me/blocks/${encodeURIComponent(userId)}`, {}),
    unblockUser: (userId: string) =>
      req<void>('DELETE', `/me/blocks/${encodeURIComponent(userId)}`),
    reportPlayer: (body: {
      userId: string;
      category: ReportCategory;
      message?: string;
      gameId?: string;
      roomCode?: string;
    }) => req<{ id: string }>('POST', '/reports/player', body),
  };
}
