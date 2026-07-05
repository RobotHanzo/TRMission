import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../i18n';
import { PurgeView } from './PurgeView';
import { useSession } from '../store/session';
import { useToast } from '../store/toast';
import { ToastStack } from '../components/ToastStack';

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
      const body = route.status === 204 ? null : JSON.stringify(route.body);
      return new Response(body, { status: route.status });
    }),
  );
}

const STATUS = {
  autoEnabled: false,
  intervalMs: 3_600_000,
  roomLobbyPurgeHours: 24,
  gameLivePurgeHours: 168,
  recentRuns: [
    {
      at: '2026-01-01T00:00:00.000Z',
      actorName: 'Admin',
      roomsDeleted: 3,
      gamesDeleted: 1,
      capped: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
  useSession.setState({
    phase: 'ready',
    user: { id: 'u1', displayName: 'Ops', isGuest: false },
    role: 'admin',
    permissions: new Set(['purge.read', 'purge.run']),
  });
  stubFetch({ '/dashboard/purge/status': { status: 200, body: STATUS } });
});

describe('PurgeView', () => {
  it('renders config and recent runs', async () => {
    render(<PurgeView />);
    expect(await screen.findByText('未啟用')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('168')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('requires confirmation before running, then shows a success toast with fresh counts', async () => {
    render(
      <>
        <PurgeView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('立即執行清理'));
    const dialog = await screen.findByRole('dialog');
    stubFetch({
      '/dashboard/purge/status': {
        status: 200,
        body: { ...STATUS, recentRuns: [{ ...STATUS.recentRuns[0], roomsDeleted: 5 }] },
      },
      '/dashboard/purge/run': { status: 200, body: { roomsDeleted: 5, gamesDeleted: 2, capped: false } },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '立即執行清理' }));
    expect(await screen.findByText('清理已完成')).toBeInTheDocument();
    expect(await screen.findByText('5')).toBeInTheDocument();
  });

  it('shows an error toast when running fails', async () => {
    render(
      <>
        <PurgeView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('立即執行清理'));
    const dialog = await screen.findByRole('dialog');
    stubFetch({
      '/dashboard/purge/status': { status: 200, body: STATUS },
      '/dashboard/purge/run': { status: 500, body: { message: 'boom' } },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '立即執行清理' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('shows an error toast when the initial status fetch fails, and stops showing the loading label', async () => {
    stubFetch({ '/dashboard/purge/status': { status: 500, body: { message: 'boom' } } });
    render(
      <>
        <PurgeView />
        <ToastStack />
      </>,
    );
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('載入中…')).not.toBeInTheDocument();
  });

  it('hides the run button without purge.run', async () => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'viewer',
      permissions: new Set(['purge.read']),
    });
    render(<PurgeView />);
    await screen.findByText('未啟用');
    expect(screen.queryByText('立即執行清理')).not.toBeInTheDocument();
  });
});
