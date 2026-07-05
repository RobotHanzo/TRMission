import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../i18n';

interface Route {
  status: number;
  body: unknown;
}
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

import { OverviewView } from './OverviewView';

const baseOverview = {
  liveGames: { db: 0, inMemory: 0 },
  rooms: { lobby: 0, started: 0 },
  users: { total: 0, guests: 0, registered: 0, disabled: 0, new24h: 0 },
  sessions: { active: 0 },
  metrics: {
    activeConnections: 0,
    commandsTotal: 0,
    rejectionsTotal: 0,
    rejectionsByCode: {},
    leaksBlocked: 0,
    residentMemoryBytes: 0,
    commandApplyAvgMs: null,
  },
  versions: {
    engineVersion: 7,
    protocolVersion: 5,
    contentHash: 'abc',
    uptimeSeconds: 60,
    commitHash: 'sha-server',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_COMMIT_HASH', 'sha-web');
});

describe('OverviewView versions tile', () => {
  it('renders both commit hashes', async () => {
    stubFetch({ '/dashboard/overview': { status: 200, body: baseOverview } });
    render(<OverviewView />);
    await waitFor(() => expect(screen.getByText('sha-server')).toBeInTheDocument());
    expect(screen.getByText('sha-web')).toBeInTheDocument();
  });

  it('shows a mismatch warning when the two hashes differ', async () => {
    stubFetch({ '/dashboard/overview': { status: 200, body: baseOverview } });
    render(<OverviewView />);
    await waitFor(() => expect(screen.getByText('sha-server')).toBeInTheDocument());
    expect(screen.getByText('伺服器與前端版本不一致')).toBeInTheDocument();
  });

  it('shows no mismatch warning when they match', async () => {
    vi.stubEnv('VITE_COMMIT_HASH', 'sha-server');
    stubFetch({ '/dashboard/overview': { status: 200, body: baseOverview } });
    render(<OverviewView />);
    // Both the server and web commit hashes render as 'sha-server' here, so two
    // separate elements share that text — getAllByText, not getByText (singular).
    await waitFor(() => expect(screen.getAllByText('sha-server').length).toBe(2));
    expect(screen.queryByText('伺服器與前端版本不一致')).not.toBeInTheDocument();
  });

  it('shows no mismatch warning when either side is the dev placeholder', async () => {
    vi.stubEnv('VITE_COMMIT_HASH', 'dev');
    stubFetch({
      '/dashboard/overview': {
        status: 200,
        body: { ...baseOverview, versions: { ...baseOverview.versions, commitHash: 'dev' } },
      },
    });
    render(<OverviewView />);
    await waitFor(() => expect(screen.getAllByText('dev').length).toBeGreaterThan(0));
    expect(screen.queryByText('伺服器與前端版本不一致')).not.toBeInTheDocument();
  });
});
