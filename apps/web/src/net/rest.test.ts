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
