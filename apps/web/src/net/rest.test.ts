import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, setAccessToken } from './rest';

// A response-shaped stub: rest.ts only reads `.ok`, `.status`, and `.json()`.
const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe('rest client silent refresh', () => {
  beforeEach(() => setAccessToken(null));
  afterEach(() => vi.restoreAllMocks());

  it('coalesces concurrent 401-driven refreshes into a single rotation', async () => {
    let refreshCount = 0;
    const fetchMock = vi.fn((path: string, init?: RequestInit) => {
      if (String(path).includes('/auth/refresh')) {
        refreshCount++;
        return Promise.resolve(res(200, { accessToken: 'AT' }));
      }
      // /auth/me is unauthorized until a token rides along (post-refresh retry).
      const auth = (init?.headers as Headers).get('Authorization');
      return Promise.resolve(auth ? res(200, { id: 'u1' }) : res(401, { message: 'no' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    // Two profile probes race on reload (React StrictMode double-invokes the restore effect).
    const [a, b] = await Promise.all([api.me(), api.me()]);

    expect(a).toEqual({ id: 'u1' });
    expect(b).toEqual({ id: 'u1' });
    // Without single-flight this is 2 — two rotations of the same refresh token trip the
    // server's reuse-detection and burn the session family, logging the user out on reload.
    expect(refreshCount).toBe(1);
  });
});

describe('rest client: per-game settings + spectating', () => {
  beforeEach(() => setAccessToken('AT'));
  afterEach(() => vi.restoreAllMocks());

  it('GETs the public rooms list', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(res(200, [])));
    vi.stubGlobal('fetch', fetchMock);
    await api.getPublicRooms();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/rooms/public',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('PATCHes a settings change', async () => {
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(res(200, { code: 'ABCDEF' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.updateRoomSettings('ABCDEF', { unlimitedStationBorrow: true });
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/v1/rooms/ABCDEF/settings');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ unlimitedStationBorrow: true });
  });

  it('POSTs a spectate request', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(res(200, { gameId: 'g', ticket: 't' })));
    vi.stubGlobal('fetch', fetchMock);
    await api.spectate('ABCDEF');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/rooms/ABCDEF/spectate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('POSTs a rematch vote', async () => {
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(res(200, { code: 'ABCDEF', members: [] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.voteRematch('ABCDEF', true);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/v1/rooms/ABCDEF/rematch-vote');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ wantsRematch: true });
  });

  it('POSTs an in-game end vote', async () => {
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(res(200, { code: 'ABCDEF', members: [] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.voteEnd('ABCDEF', true);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/v1/rooms/ABCDEF/end-vote');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ wantsEnd: true });
  });

  it('POSTs a rematch request', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(res(200, { code: 'ABCDEF', members: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await api.rematch('ABCDEF');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/rooms/ABCDEF/rematch',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
