import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import { GamesView } from './GamesView';
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
      return new Response(JSON.stringify(route.body), { status: route.status });
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
