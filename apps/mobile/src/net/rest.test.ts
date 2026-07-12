import { api, setAccessToken } from './rest';
import * as secureStore from './secureStore';

jest.mock('./secureStore', () => ({
  getRefreshToken: jest.fn(),
  setRefreshToken: jest.fn(),
  clearRefreshToken: jest.fn(),
}));

const store = secureStore as jest.Mocked<typeof secureStore>;

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}
const res = (status: number, body: unknown): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'status',
  json: async () => body,
});
const headersOf = (init: RequestInit): Headers => new Headers(init.headers);

describe('mobile REST client', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    setAccessToken(null);
    store.getRefreshToken.mockResolvedValue(null);
    store.setRefreshToken.mockResolvedValue(undefined);
    store.clearRefreshToken.mockResolvedValue(undefined);
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it('sends Authorization + x-trm-client: mobile on every request', async () => {
    setAccessToken('access-1');
    fetchMock.mockResolvedValueOnce(res(200, { id: 'u1' }));

    await api.me();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/auth/me');
    expect(headersOf(init).get('Authorization')).toBe('Bearer access-1');
    expect(headersOf(init).get('x-trm-client')).toBe('mobile');
  });

  it('on 401 refreshes once with the stored refresh token, persists the rotation, and retries', async () => {
    setAccessToken('stale');
    store.getRefreshToken.mockResolvedValue('refresh-1');
    fetchMock
      .mockResolvedValueOnce(res(401, {})) // me → 401
      .mockResolvedValueOnce(res(200, { accessToken: 'access-2', refreshToken: 'refresh-2' })) // refresh
      .mockResolvedValueOnce(res(200, { id: 'u1' })); // retry me

    const user = await api.me();
    expect(user).toEqual({ id: 'u1' });

    const refreshCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/auth/refresh')) as
      | [string, RequestInit]
      | undefined;
    expect(refreshCall).toBeDefined();
    expect(JSON.parse(String(refreshCall![1].body))).toEqual({ refreshToken: 'refresh-1' });
    expect(store.setRefreshToken).toHaveBeenCalledWith('refresh-2');

    const retryInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect(headersOf(retryInit).get('Authorization')).toBe('Bearer access-2');
  });

  it('shares a single refresh across concurrent 401s (single-flight)', async () => {
    setAccessToken('stale');
    store.getRefreshToken.mockResolvedValue('refresh-1');
    let refreshCount = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (String(url).includes('/auth/refresh')) {
        refreshCount += 1;
        return res(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      return headersOf(init).get('Authorization') === 'Bearer access-2'
        ? res(200, { id: 'u1' })
        : res(401, {});
    });

    const [a, b] = await Promise.all([api.me(), api.me()]);
    expect(a).toEqual({ id: 'u1' });
    expect(b).toEqual({ id: 'u1' });
    expect(refreshCount).toBe(1);
  });

  it('a refresh with no stored token does not retry and surfaces the 401', async () => {
    setAccessToken('stale');
    store.getRefreshToken.mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(res(401, { message: 'unauthorized' }));

    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt, no retry
  });

  it('captures both tokens on issuance (guest) — access in memory, refresh to the keystore', async () => {
    fetchMock.mockResolvedValueOnce(
      res(201, { user: { id: 'g1' }, accessToken: 'access-1', refreshToken: 'refresh-1' }),
    );

    const result = await api.guest('旅客');
    expect(result.accessToken).toBe('access-1');
    expect(store.setRefreshToken).toHaveBeenCalledWith('refresh-1');
  });
});
