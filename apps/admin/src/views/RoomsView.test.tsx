import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../i18n';
import { RoomsView } from './RoomsView';
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

const ROOM_ROW = {
  code: 'ABCD',
  hostId: 'h1',
  status: 'LOBBY',
  memberCount: 1,
  maxPlayers: 5,
  visibility: 'PUBLIC',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  members: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
  useUi.setState({ view: 'rooms', param: null });
  useSession.setState({
    phase: 'ready',
    user: { id: 'u1', displayName: 'Ops', isGuest: false },
    role: 'admin',
    permissions: new Set(['rooms.read', 'rooms.close']),
  });
});

describe('RoomsView close toasts', () => {
  it('shows a success toast after closing a room', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD/close': { status: 200, body: { ...ROOM_ROW, status: 'CLOSED' } },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('關閉房間'));
    // The trigger button and the confirm dialog's confirm button share the same label
    // ('關閉房間'), so scope the second click to the dialog to avoid an ambiguous match.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉房間' }));
    expect(await screen.findByText('房間已關閉')).toBeInTheDocument();
  });

  it('shows an error toast when closing fails (previously an unhandled rejection)', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD/close': { status: 500, body: { message: 'boom' } },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('關閉房間'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉房間' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});

describe('RoomsView delete toasts', () => {
  beforeEach(() => {
    useToast.getState().reset();
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['rooms.read', 'rooms.close', 'rooms.delete']),
    });
  });

  it('shows a success toast after deleting a room and removes its row', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD': { status: 204, body: {} },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除房間'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除房間' }));
    expect(await screen.findByText('房間已刪除')).toBeInTheDocument();
    expect(screen.queryByText('ABCD')).not.toBeInTheDocument();
  });

  it('shows an error toast when deleting fails and keeps the row', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD': { status: 500, body: { message: 'boom' } },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除房間'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除房間' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByText('ABCD')).toBeInTheDocument();
  });

  it('shows the STARTED-specific confirm body when deleting a started room', async () => {
    const startedRow = { ...ROOM_ROW, status: 'STARTED' };
    stubFetch({
      '/dashboard/rooms/ABCD': { status: 204, body: {} },
      '/dashboard/rooms?': { status: 200, body: { rooms: [startedRow], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除房間'));
    expect(
      await screen.findByText('此房間仍有進行中的對局,將先強制終止該對局(不會留下成績),再永久刪除房間紀錄。此操作無法復原。'),
    ).toBeInTheDocument();
  });
});
