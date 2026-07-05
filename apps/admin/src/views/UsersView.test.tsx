import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
