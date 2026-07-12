// Mobile transport over the shared REST client (@trm/client-core): an ABSOLUTE base (the app is
// not served same-origin, so there is no cookie jar) and token-in-body refresh (P0-a
// `x-trm-client: mobile`) — the access token lives in memory inside the shared core, the refresh
// token in the OS keystore (secureStore), and a 401 rotates via the body.
import { createRestClient } from '@trm/client-core';
import { SERVER_ORIGIN } from '../config';
import { clearRefreshToken, getRefreshToken, setRefreshToken } from './secureStore';

export { ApiError } from '@trm/client-core';
export type * from '@trm/client-core/net/restTypes';

const client = createRestClient({
  baseUrl: SERVER_ORIGIN,
  extraHeaders: { 'x-trm-client': 'mobile' },
  refresh: async () => {
    const token = await getRefreshToken();
    if (!token) return null; // no keystore token → nothing to rotate (fresh install / signed out)
    const res = await fetch(`${SERVER_ORIGIN}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-trm-client': 'mobile' },
      body: JSON.stringify({ refreshToken: token }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken: string; refreshToken?: string };
    // Body-in → body-out: persist the rotated refresh token (the mobile analogue of the cookie).
    if (data.refreshToken) await setRefreshToken(data.refreshToken);
    return { accessToken: data.accessToken };
  },
  persistRefreshToken: (t) => setRefreshToken(t),
  readRefreshToken: () => getRefreshToken(),
  clearRefreshToken: () => clearRefreshToken(),
});

export const api = client.api;
export const req = client.req;
export const setAccessToken = client.setAccessToken;
export const setOnTokenChange = client.setOnTokenChange;
