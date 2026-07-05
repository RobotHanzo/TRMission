import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../i18n';
import { MapsView } from './MapsView';
import { useUi } from '../store/ui';

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

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'maps', param: null });
  stubFetch({ '/dashboard/maps': { status: 200, body: { maps: [MAP_ROW], nextCursor: null } } });
});

describe('MapsView', () => {
  it('lists maps with owner name', async () => {
    render(<MapsView />);
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});
