import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../i18n';
import { RatingsView } from './RatingsView';
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
      return new Response(JSON.stringify(route.body), { status: route.status });
    }),
  );
}

const RATING_ROW = {
  id: 'r1',
  userId: 'u1',
  userDisplayName: 'Alice',
  gameId: 'game-1',
  roomId: 'ABCDE',
  stars: 4,
  text: 'Loved the map!',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'ratings', param: null });
  stubFetch({
    '/dashboard/ratings': {
      status: 200,
      body: { ratings: [RATING_ROW], nextCursor: null, avgStars: 4, totalCount: 1 },
    },
  });
});

describe('RatingsView', () => {
  it('lists ratings with the average/total summary', async () => {
    render(<RatingsView />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText('平均 4.0 顆星．共 1 筆')).toBeInTheDocument();
    expect(screen.getByText('Loved the map!')).toBeInTheDocument();
  });
});
