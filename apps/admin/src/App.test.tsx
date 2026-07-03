import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import { useSession } from './store/session';
import { useUi } from './store/ui';

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

const OVERVIEW = {
  liveGames: { db: 1, inMemory: 1 },
  rooms: { lobby: 2, started: 1 },
  users: { total: 10, guests: 6, registered: 4, disabled: 0, new24h: 3 },
  sessions: { active: 5 },
  metrics: {
    activeConnections: 4,
    commandsTotal: 100,
    rejectionsTotal: 2,
    rejectionsByCode: {},
    leaksBlocked: 0,
    residentMemoryBytes: 100_000_000,
    commandApplyAvgMs: 1.5,
  },
  versions: { engineVersion: 1, protocolVersion: 1, contentHash: 'abcdef1234567890', uptimeSeconds: 3600 },
};

function primeSession(permissions: string[], role = 'viewer') {
  stubFetch({
    '/auth/me': { status: 200, body: { id: 'u1', displayName: 'Ops', isGuest: false } },
    '/dashboard/me': {
      status: 200,
      body: { userId: 'u1', displayName: 'Ops', role, permissions },
    },
    '/dashboard/overview': { status: 200, body: OVERVIEW },
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/admin/');
  useUi.setState({ view: 'overview', param: null });
  useSession.setState({
    phase: 'booting',
    user: null,
    role: null,
    permissions: new Set(),
    loading: false,
    error: null,
  });
});

describe('permission-gated shell', () => {
  it('a viewer sees only the sections their permissions allow', async () => {
    primeSession(['overview.read', 'users.read', 'games.read', 'rooms.read']);
    render(<App />);
    expect(await screen.findByText('使用者')).toBeInTheDocument(); // nav item
    expect(screen.getByText('對局')).toBeInTheDocument();
    expect(screen.getByText('房間')).toBeInTheDocument();
    expect(screen.queryByText('維護者')).not.toBeInTheDocument();
    expect(screen.queryByText('稽核')).not.toBeInTheDocument();
  });

  it('an owner sees every section', async () => {
    primeSession(
      [
        'overview.read',
        'users.read',
        'users.ban',
        'games.read',
        'games.readLog',
        'games.terminate',
        'rooms.read',
        'rooms.close',
        'maintainers.read',
        'maintainers.write',
        'audit.read',
      ],
      'owner',
    );
    render(<App />);
    expect(await screen.findByText('維護者')).toBeInTheDocument();
    expect(screen.getByText('稽核')).toBeInTheDocument();
  });

  it('a denied account gets the denied screen with a sign-out', async () => {
    stubFetch({
      '/auth/me': { status: 200, body: { id: 'u1', displayName: 'Nobody', isGuest: false } },
      '/dashboard/me': { status: 404, body: { message: 'Not Found' } },
    });
    render(<App />);
    expect(await screen.findByText('此帳號沒有後台權限')).toBeInTheDocument();
    expect(screen.getByText('登出')).toBeInTheDocument();
  });
});
