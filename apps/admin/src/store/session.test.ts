import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSession } from './session';

type Route = { status: number; body: unknown };

function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.entries(routes).find(([path]) => url.includes(path));
      const route = hit?.[1] ?? { status: 404, body: { message: 'not found' } };
      return new Response(JSON.stringify(route.body), { status: route.status });
    }),
  );
}

const gameUser = (isGuest: boolean) => ({
  id: 'u1',
  displayName: 'Tester',
  isGuest,
});

beforeEach(() => {
  useSession.setState({
    phase: 'booting',
    user: null,
    role: null,
    permissions: new Set(),
    loading: false,
    error: null,
  });
});

describe('session gate', () => {
  it('a guest session is denied even before the dashboard probe', async () => {
    stubFetch({ '/auth/me': { status: 200, body: gameUser(true) } });
    await useSession.getState().restore();
    expect(useSession.getState().phase).toBe('denied');
  });

  it('a registered user without a dashboard record is denied', async () => {
    stubFetch({
      '/auth/me': { status: 200, body: gameUser(false) },
      '/dashboard/me': { status: 404, body: { message: 'Not Found' } },
    });
    await useSession.getState().restore();
    expect(useSession.getState().phase).toBe('denied');
  });

  it('a maintainer lands ready with the permission set', async () => {
    stubFetch({
      '/auth/me': { status: 200, body: gameUser(false) },
      '/dashboard/me': {
        status: 200,
        body: {
          userId: 'u1',
          displayName: 'Tester',
          role: 'viewer',
          permissions: ['overview.read', 'users.read'],
        },
      },
    });
    await useSession.getState().restore();
    const s = useSession.getState();
    expect(s.phase).toBe('ready');
    expect(s.role).toBe('viewer');
    expect(s.hasPermission('users.read')).toBe(true);
    expect(s.hasPermission('users.ban')).toBe(false);
  });

  it('no session at all → unauthenticated', async () => {
    stubFetch({
      '/auth/me': { status: 401, body: { message: 'missing bearer token' } },
      '/auth/refresh': { status: 401, body: { message: 'no refresh token' } },
    });
    await useSession.getState().restore();
    expect(useSession.getState().phase).toBe('unauthenticated');
  });
});
