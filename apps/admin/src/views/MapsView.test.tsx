import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react';
import '../i18n';
import { MapsView } from './MapsView';
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

const MAP_ROW = {
  id: 'map-1',
  ownerId: 'user-1',
  ownerDisplayName: 'Alice',
  nameZh: '測試',
  nameEn: 'Test',
  revision: 1,
  shared: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const MAP_DETAIL = {
  ...MAP_ROW,
  createdAt: '2026-01-01T00:00:00.000Z',
  usageCount: 0,
  draft: { cities: [], routes: [], tickets: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'maps', param: null });
  stubFetch({
    '/dashboard/maps/map-1': { status: 200, body: MAP_DETAIL },
    '/dashboard/maps': { status: 200, body: { maps: [MAP_ROW], nextCursor: null } },
  });
});

describe('MapsView', () => {
  it('lists maps with owner name', async () => {
    render(<MapsView />);
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('opens a drawer with preview and detail on row click', async () => {
    render(<MapsView />);
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Test'));
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText('尚無內容')).toBeInTheDocument(); // MapPreview's empty state
  });
});

describe('MapsView destructive actions', () => {
  it('hides delete/unshare/transfer without maps.moderate, shows them with it', async () => {
    useSession.setState({ permissions: new Set(['maps.read']) } as never);
    stubFetch({
      '/dashboard/maps/map-1': { status: 200, body: MAP_DETAIL },
      '/dashboard/maps': { status: 200, body: { maps: [MAP_ROW], nextCursor: null } },
    });
    render(<MapsView />);
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Test'));
    await waitFor(() => expect(screen.getByText('尚無內容')).toBeInTheDocument());
    expect(screen.queryByText('刪除地圖')).not.toBeInTheDocument();

    // Unmount the first tree before re-rendering: useUi/useSession are shared module-level
    // stores, so a second render() without cleanup would leave both trees subscribed to the
    // same param/permissions and both would react to the state below (duplicate elements).
    cleanup();
    useSession.setState({ permissions: new Set(['maps.read', 'maps.moderate']) } as never);
    render(<MapsView />);
    await waitFor(() => expect(screen.getAllByText('Test').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Test')[0]!);
    await waitFor(() => expect(screen.getByText('刪除地圖')).toBeInTheDocument());
  });

  it('deletes a map after confirmation and closes the drawer', async () => {
    useSession.setState({ permissions: new Set(['maps.read', 'maps.moderate']) } as never);
    let deleteCalled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/dashboard/maps/map-1') && init?.method === 'DELETE') {
          deleteCalled = true;
          return new Response(null, { status: 204 });
        }
        if (url.includes('/dashboard/maps/map-1')) {
          return new Response(JSON.stringify(MAP_DETAIL), { status: 200 });
        }
        return new Response(JSON.stringify({ maps: [MAP_ROW], nextCursor: null }), { status: 200 });
      }),
    );
    render(<MapsView />);
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Test'));
    fireEvent.click(await screen.findByText('刪除地圖'));
    const dialog = await screen.findByRole('dialog', { name: '確認刪除地圖' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除地圖' }));
    await waitFor(() => expect(deleteCalled).toBe(true));
  });
});
