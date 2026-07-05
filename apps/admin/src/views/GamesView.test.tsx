import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '../i18n';
import { GamesView } from './GamesView';
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

const GAME_DETAIL = {
  gameId: 'g1',
  status: 'COMPLETED',
  currentSeq: 2,
  engineVersion: 1,
  contentHash: 'abc',
  schemaVersion: 1,
  inMemory: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  seed: 'seed-1',
  players: [{ id: 'p-one', seat: 0, isBot: false }],
  spectators: [],
  chat: [
    { playerId: 'p-one', ts: '2026-01-01T00:00:00.000Z', kind: 'text', value: 'gg' },
    { playerId: 'p-two', ts: '2026-01-01T00:00:01.000Z', kind: 'preset', value: 'GOOD_GAME' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'games', param: 'g1' });
  useSession.setState({
    phase: 'ready',
    user: { id: 'u1', displayName: 'Ops', isGuest: false },
    role: 'admin',
    permissions: new Set(['games.read']),
  });
  stubFetch({
    '/dashboard/games/g1': { status: 200, body: GAME_DETAIL },
    '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
  });
});

describe('GamesView chat section', () => {
  it('renders free text unmarked and a preset translated with a badge', async () => {
    render(<GamesView />);
    expect(await screen.findByText('gg')).toBeInTheDocument();
    expect(await screen.findByText('這局精彩!')).toBeInTheDocument();
    expect(screen.queryByText('GOOD_GAME')).not.toBeInTheDocument();
    expect(screen.getByText('預設')).toBeInTheDocument();
  });
});

describe('GamesView terminate toasts', () => {
  beforeEach(() => {
    useToast.getState().reset();
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['games.read', 'games.terminate']),
    });
  });

  it('shows a success toast after terminating a live game', async () => {
    useUi.setState({ view: 'games', param: 'g1' });
    stubFetch({
      '/dashboard/games/g1/terminate': {
        status: 200,
        body: { ...GAME_DETAIL, status: 'TERMINATED' },
      },
      '/dashboard/games/g1': { status: 200, body: { ...GAME_DETAIL, status: 'LIVE' } },
      '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
    });
    render(
      <>
        <GamesView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('強制終止'));
    // The drawer itself and the confirm dialog both have role="dialog", and the trigger
    // button shares its label ('強制終止') with the dialog's confirm button — so target the
    // confirm dialog specifically by its own title (aria-label) to avoid any ambiguity.
    const dialog = await screen.findByRole('dialog', { name: '強制終止此對局?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '強制終止' }));
    expect(await screen.findByText('對局已強制終止')).toBeInTheDocument();
  });

  it('shows an error toast when termination fails (previously an unhandled rejection)', async () => {
    useUi.setState({ view: 'games', param: 'g1' });
    stubFetch({
      '/dashboard/games/g1/terminate': { status: 500, body: { message: 'boom' } },
      '/dashboard/games/g1': { status: 200, body: { ...GAME_DETAIL, status: 'LIVE' } },
      '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
    });
    render(
      <>
        <GamesView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('強制終止'));
    const dialog = await screen.findByRole('dialog', { name: '強制終止此對局?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '強制終止' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});

// GET /dashboard/games/g1 (detail) and DELETE /dashboard/games/g1 (this task's new route)
// hit the IDENTICAL path — REST convention, no /verb suffix like /terminate has — and
// stubFetch() only matches by URL substring, blind to HTTP method. So the two tests that
// actually invoke delete use a bespoke sequenced mock (1st hit to that path = the detail
// GET, 2nd = the delete) instead of the shared stubFetch. The third test never clicks
// confirm (no delete call fires), so it can use stubFetch as normal.
describe('GamesView delete toasts', () => {
  beforeEach(() => {
    useToast.getState().reset();
    useUi.setState({ view: 'games', param: 'g1' });
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['games.read', 'games.delete']),
    });
  });

  it('shows a success toast and closes the drawer after deleting a game', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard/games?')) {
          return new Response(JSON.stringify({ games: [], nextCursor: null }), { status: 200 });
        }
        if (url.includes('/dashboard/games/g1')) {
          call += 1;
          if (call === 1) return new Response(JSON.stringify(GAME_DETAIL), { status: 200 });
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
      }),
    );
    render(
      <>
        <GamesView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除對局'));
    const dialog = await screen.findByRole('dialog', { name: '刪除此對局?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除對局' }));
    expect(await screen.findByText('對局已刪除')).toBeInTheDocument();
  });

  it('shows an error toast when deleting fails', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard/games?')) {
          return new Response(JSON.stringify({ games: [], nextCursor: null }), { status: 200 });
        }
        if (url.includes('/dashboard/games/g1')) {
          call += 1;
          if (call === 1) return new Response(JSON.stringify(GAME_DETAIL), { status: 200 });
          return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
        }
        return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
      }),
    );
    render(
      <>
        <GamesView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除對局'));
    const dialog = await screen.findByRole('dialog', { name: '刪除此對局?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除對局' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('shows the LIVE-specific confirm body when deleting a live game', async () => {
    stubFetch({
      '/dashboard/games/g1': { status: 200, body: { ...GAME_DETAIL, status: 'LIVE' } },
      '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
    });
    render(<GamesView />);
    fireEvent.click(await screen.findByText('刪除對局'));
    expect(
      await screen.findByText(
        '此對局仍在進行中,將先強制終止(不會留下成績,無法重播),再永久刪除對局紀錄。此操作無法復原。',
      ),
    ).toBeInTheDocument();
  });
});

describe('GamesView view-replay button', () => {
  beforeEach(() => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['games.read', 'games.viewReplay']),
    });
  });

  it('opens a new tab to the web app admin-replay route with a minted ticket', async () => {
    useUi.setState({ view: 'games', param: 'g1' });
    stubFetch({
      '/dashboard/games/g1/replay-ticket': {
        status: 200,
        body: { ticket: 'tok', expiresIn: '5m' },
      },
      '/dashboard/games/g1': { status: 200, body: { ...GAME_DETAIL, status: 'COMPLETED' } },
      '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<GamesView />);
    fireEvent.click(await screen.findByText('查看回放'));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('/admin-replay/g1?ticket=tok'),
        '_blank',
      ),
    );
  });
});
