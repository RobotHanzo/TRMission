import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import '../i18n';
import { UsersView } from './UsersView';
import { useUi } from '../store/ui';
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
      return new Response(JSON.stringify(route.body), { status: route.status });
    }),
  );
}

const USER_DETAIL = {
  id: 'u1',
  displayName: 'Alice',
  isGuest: false,
  oauthProviders: [],
  hasPassword: true,
  features: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  activeSessions: 0,
  activeRooms: [],
  history: [],
  isMaintainer: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
  useUi.setState({ view: 'users', param: 'u1' });
  useSession.setState({
    phase: 'ready',
    user: { id: 'admin1', displayName: 'Ops', isGuest: false },
    role: 'admin',
    permissions: new Set(['users.read', 'users.ban']),
  });
});

describe('UsersView ban/unban toasts', () => {
  it('shows a success toast after disabling a user', async () => {
    stubFetch({
      '/dashboard/users/u1': { status: 200, body: USER_DETAIL },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(
      <>
        <UsersView />
        <ToastStack />
      </>,
    );
    // '停權' is also the label of the "Disabled" filter tab in the toolbar, and it renders
    // synchronously before the drawer's async detail loads — so scope the trigger click to
    // the drawer (named "Alice") to avoid matching the tab instead.
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    fireEvent.click(within(drawer).getByText('停權'));
    // The drawer itself and the confirm dialog both have role="dialog", and the trigger
    // button shares its label ('停權') with the dialog's confirm button — so target the
    // confirm dialog specifically by its own title (aria-label) to avoid any ambiguity.
    const dialog = await screen.findByRole('dialog', { name: '停權此帳號?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '停權' }));
    expect(await screen.findByText('帳號已停權')).toBeInTheDocument();
  });

  it('shows an error toast when disabling fails (a request that previously failed silently)', async () => {
    stubFetch({
      '/dashboard/users/u1/disable': { status: 500, body: { message: 'boom' } },
      '/dashboard/users/u1': { status: 200, body: USER_DETAIL },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(
      <>
        <UsersView />
        <ToastStack />
      </>,
    );
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    fireEvent.click(within(drawer).getByText('停權'));
    const dialog = await screen.findByRole('dialog', { name: '停權此帳號?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '停權' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});

describe('UsersView columns', () => {
  it('renders OAuth badges and an expiry timestamp for a disabled guest', async () => {
    useUi.setState({ view: 'users', param: null });
    stubFetch({
      '/dashboard/users?': {
        status: 200,
        body: {
          users: [
            {
              id: 'g1',
              displayName: 'Guest One',
              isGuest: true,
              oauthProviders: ['google'],
              hasPassword: false,
              features: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              disabledAt: '2026-01-02T00:00:00.000Z',
              guestExpiresAt: '2026-07-12T03:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      },
    });
    render(<UsersView />);
    expect(await screen.findByTitle('Google')).toBeInTheDocument();
    expect(screen.getByText('（已停權）')).toBeInTheDocument();
  });

  it('renders a dash in the Expires column for a registered account', async () => {
    useUi.setState({ view: 'users', param: null });
    stubFetch({
      '/dashboard/users?': {
        status: 200,
        body: {
          users: [
            {
              id: 'r1',
              displayName: 'Reg One',
              isGuest: false,
              oauthProviders: [],
              hasPassword: true,
              features: [],
              tutorialCompleted: true,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      },
    });
    render(<UsersView />);
    expect(await screen.findByTitle('密碼')).toBeInTheDocument();
    // Two dashes expected: Email column ("—") and Expires column ("—").
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});

describe('UsersView delete account', () => {
  it('hides the delete button without users.delete permission', async () => {
    stubFetch({
      '/dashboard/users/u1': { status: 200, body: USER_DETAIL },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(<UsersView />);
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    // Disable IS available (users.ban is in the default perms); delete is NOT.
    expect(within(drawer).getByText('停權')).toBeInTheDocument();
    expect(within(drawer).queryByText('刪除帳號')).toBeNull();
  });

  it('deletes a user: confirm issues DELETE and closes the drawer', async () => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'admin1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['users.read', 'users.ban', 'users.delete']),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'DELETE' && url.includes('/dashboard/users/u1')) {
          return new Response(null, { status: 204 });
        }
        if (url.includes('/dashboard/users/u1')) {
          return new Response(JSON.stringify(USER_DETAIL), { status: 200 });
        }
        if (url.includes('/dashboard/users?')) {
          return new Response(JSON.stringify({ users: [], nextCursor: null }), { status: 200 });
        }
        return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
      }),
    );
    render(
      <>
        <UsersView />
        <ToastStack />
      </>,
    );
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    fireEvent.click(within(drawer).getByText('刪除帳號'));
    const dialog = await screen.findByRole('dialog', { name: '永久刪除此帳號?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除帳號' }));

    expect(await screen.findByText('帳號已刪除')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alice' })).toBeNull());
    expect(
      vi.mocked(fetch).mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE'),
    ).toBe(true);
  });

  it('removes the deleted user from the table without a full page reload', async () => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'admin1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['users.read', 'users.ban', 'users.delete']),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'DELETE' && url.includes('/dashboard/users/u1')) {
          return new Response(null, { status: 204 });
        }
        if (url.includes('/dashboard/users?')) {
          return new Response(JSON.stringify({ users: [USER_DETAIL], nextCursor: null }), {
            status: 200,
          });
        }
        if (url.includes('/dashboard/users/u1')) {
          return new Response(JSON.stringify(USER_DETAIL), { status: 200 });
        }
        return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
      }),
    );
    render(
      <>
        <UsersView />
        <ToastStack />
      </>,
    );
    // Row is present in the table before deletion.
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);

    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    fireEvent.click(within(drawer).getByText('刪除帳號'));
    const dialog = await screen.findByRole('dialog', { name: '永久刪除此帳號?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除帳號' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alice' })).toBeNull());
    expect(screen.queryByText('Alice')).toBeNull();
  });
});

describe('UsersView search debounce', () => {
  it('debounces typed search input by 300ms before calling the API', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useUi.setState({ view: 'users', param: null });
      stubFetch({ '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } } });
      const fetchSpy = vi.mocked(fetch);
      render(<UsersView />);
      await screen.findByPlaceholderText('搜尋 ID、電子郵件或名稱…');
      const callsBeforeTyping = fetchSpy.mock.calls.length;

      fireEvent.change(screen.getByPlaceholderText('搜尋 ID、電子郵件或名稱…'), {
        target: { value: 'alice' },
      });
      // 260ms: past the old 250ms delay (would already have fired under the previous
      // implementation) but still under the new 300ms delay — this is what actually
      // discriminates the two, unlike a 200ms/350ms split which both satisfy.
      await act(async () => {
        vi.advanceTimersByTime(260);
      });
      expect(fetchSpy.mock.calls.length).toBe(callsBeforeTyping);

      await act(async () => {
        vi.advanceTimersByTime(50); // total 310ms, past the 300ms debounce
      });
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBeforeTyping);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('UsersView tutorial-completed flag', () => {
  it('shows a check mark in the table for a completed account', async () => {
    useUi.setState({ view: 'users', param: null });
    stubFetch({
      '/dashboard/users?': {
        status: 200,
        body: { users: [{ ...USER_DETAIL, tutorialCompleted: true }], nextCursor: null },
      },
    });
    render(<UsersView />);
    expect(await screen.findByText('✓')).toBeInTheDocument();
  });

  it("lets a permitted admin reset a completed account's tutorial flag", async () => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'admin1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['users.read', 'users.tutorialReset']),
    });
    stubFetch({
      '/dashboard/users/u1/tutorial-reset': {
        status: 200,
        body: { ...USER_DETAIL, tutorialCompleted: false },
      },
      '/dashboard/users/u1': { status: 200, body: { ...USER_DETAIL, tutorialCompleted: true } },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(
      <>
        <UsersView />
        <ToastStack />
      </>,
    );
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    fireEvent.click(within(drawer).getByText('重置教學狀態'));
    expect(await screen.findByText('已重置教學狀態')).toBeInTheDocument();
  });

  it('hides the reset control without users.tutorialReset permission', async () => {
    stubFetch({
      '/dashboard/users/u1': { status: 200, body: { ...USER_DETAIL, tutorialCompleted: true } },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(<UsersView />);
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    expect(within(drawer).queryByText('重置教學狀態')).toBeNull();
  });
});
