import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../i18n';
import { ReportsView } from './ReportsView';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';

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

const OPEN_ROW = {
  id: 'r1',
  kind: 'player',
  status: 'open',
  category: 'HARASSMENT',
  reporterId: 'u-rep',
  reporterName: 'Reporter',
  reportedUserId: 'u-bad',
  reportedName: 'Menace',
  roomCode: 'ABCD',
  message: 'said awful things',
  createdAt: '2026-07-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'reports', param: null });
  useSession.setState({
    phase: 'ready',
    user: { id: 'u1', displayName: 'Ops', isGuest: false },
    role: 'moderator',
    permissions: new Set(['reports.read', 'reports.resolve']),
  });
});

describe('ReportsView', () => {
  it('renders an open report row with target, category, and context', async () => {
    stubFetch({
      '/dashboard/reports?': { status: 200, body: { reports: [OPEN_ROW], nextCursor: null } },
    });
    render(<ReportsView />);
    expect(await screen.findByText('Menace')).toBeInTheDocument();
    expect(screen.getByText('騷擾')).toBeInTheDocument(); // category_HARASSMENT zh-Hant
    expect(screen.getByText('said awful things')).toBeInTheDocument();
    expect(screen.getByText(/ABCD/)).toBeInTheDocument();
  });

  it('resolves through the confirm dialog and flips the row to resolved', async () => {
    stubFetch({
      '/dashboard/reports/r1/resolve': {
        status: 200,
        body: { ...OPEN_ROW, status: 'resolved', resolvedByName: 'Ops' },
      },
      '/dashboard/reports?': { status: 200, body: { reports: [OPEN_ROW], nextCursor: null } },
    });
    render(<ReportsView />);
    fireEvent.click(await screen.findByText('標記已處理'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '標記已處理' }));
    // The '已處理' tab shares the resolved-status label, so scope to the table (the badge).
    const table = screen.getByRole('table');
    expect(await within(table).findByText('已處理')).toBeInTheDocument();
  });

  it('hides the resolve button without reports.resolve', async () => {
    useSession.setState({ permissions: new Set(['reports.read']) });
    stubFetch({
      '/dashboard/reports?': { status: 200, body: { reports: [OPEN_ROW], nextCursor: null } },
    });
    render(<ReportsView />);
    expect(await screen.findByText('Menace')).toBeInTheDocument();
    expect(screen.queryByText('標記已處理')).not.toBeInTheDocument();
  });
});
