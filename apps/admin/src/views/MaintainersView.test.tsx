import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../i18n';
import { MaintainersView } from './MaintainersView';
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
      // A 204 response must not carry a body, or the Response constructor throws.
      const body = route.status === 204 ? null : JSON.stringify(route.body);
      return new Response(body, { status: route.status });
    }),
  );
}

const MAINTAINER_ROW = {
  userId: 'm1',
  role: 'moderator',
  extraPermissions: [],
  deniedPermissions: [],
  permissions: ['users.read'],
  grantedBy: 'admin1',
  grantedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  dangling: false,
  displayName: 'Mod One',
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
  useUi.setState({ view: 'maintainers', param: null });
  useSession.setState({
    phase: 'ready',
    user: { id: 'admin1', displayName: 'Ops', isGuest: false },
    role: 'owner',
    permissions: new Set(['maintainers.read', 'maintainers.write']),
  });
});

describe('MaintainersView save/revoke toasts', () => {
  it('shows a success toast after saving a maintainer', async () => {
    stubFetch({
      '/dashboard/maintainers/m1': { status: 200, body: MAINTAINER_ROW },
      '/dashboard/maintainers': { status: 200, body: { maintainers: [MAINTAINER_ROW] } },
    });
    render(
      <>
        <MaintainersView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('編輯'));
    fireEvent.click(await screen.findByText('儲存'));
    expect(await screen.findByText('維護者權限已儲存')).toBeInTheDocument();
  });

  it('shows a success toast after revoking a maintainer', async () => {
    stubFetch({
      '/dashboard/maintainers/m1': { status: 204, body: {} },
      '/dashboard/maintainers': { status: 200, body: { maintainers: [MAINTAINER_ROW] } },
    });
    render(
      <>
        <MaintainersView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('撤銷'));
    // The trigger button and the confirm dialog's confirm button share the same label
    // ('撤銷'), so scope the second click to the dialog to avoid an ambiguous match.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '撤銷' }));
    expect(await screen.findByText('維護者權限已撤銷')).toBeInTheDocument();
  });

  it('shows an error toast when revoking fails (previously an unhandled rejection)', async () => {
    stubFetch({
      '/dashboard/maintainers/m1': { status: 500, body: { message: 'boom' } },
      '/dashboard/maintainers': { status: 200, body: { maintainers: [MAINTAINER_ROW] } },
    });
    render(
      <>
        <MaintainersView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('撤銷'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '撤銷' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
