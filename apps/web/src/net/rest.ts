// Web transport over the shared REST client (@trm/client-core): same-origin base, and the
// refresh token is an httpOnly cookie sent automatically (credentials: 'include') — a 401
// triggers one silent cookie-based refresh + retry inside the shared core.
import { createRestClient } from '@trm/client-core';

export { ApiError } from '@trm/client-core';
export type * from '@trm/client-core/net/restTypes';

const client = createRestClient({
  baseUrl: '',
  credentials: 'include',
  refresh: async () => {
    const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as { accessToken: string };
  },
});

export const api = client.api;
export const setAccessToken = client.setAccessToken;
export const setOnTokenChange = client.setOnTokenChange;
