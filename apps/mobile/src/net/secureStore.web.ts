// Web-harness variant (Metro resolves .web.ts on web only — see native secureStore.ts): the
// browser has no OS keystore, so the refresh token lives in localStorage. That matches a dev web
// client's security posture, which is fine for the Playwright/agent harness this platform exists
// for — this surface never ships to end users. Persisting (vs in-memory) keeps session restore
// testable across reloads.
const REFRESH_KEY = 'trm.refresh';

export const getRefreshToken = async (): Promise<string | null> =>
  localStorage.getItem(REFRESH_KEY);

export const setRefreshToken = async (token: string): Promise<void> => {
  localStorage.setItem(REFRESH_KEY, token);
};

export const clearRefreshToken = async (): Promise<void> => {
  localStorage.removeItem(REFRESH_KEY);
};
