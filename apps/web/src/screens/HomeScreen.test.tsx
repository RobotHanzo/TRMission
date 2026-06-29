import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../i18n';
import { HomeScreen } from './HomeScreen';
import { useSession } from '../store/session';
import { api, type RoomView } from '../net/rest';

vi.mock('../net/connection', () => ({ connectGame: vi.fn() }));
vi.mock('../net/rest', () => ({
  setOnTokenChange: vi.fn(),
  setAccessToken: vi.fn(),
  api: {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    getPublicRooms: vi.fn(() => Promise.resolve([])),
    spectate: vi.fn(() => Promise.resolve({ gameId: 'g', ticket: 't' })),
  },
}));

const mocked = api as unknown as {
  getPublicRooms: ReturnType<typeof vi.fn>;
  spectate: ReturnType<typeof vi.fn>;
};

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
} as const;

const settings = {
  unlimitedStationBorrow: false,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
  doubleRouteSingleFor23: true,
  allowSpectating: true,
  visibility: 'PUBLIC' as const,
};
const pubRoom = (code: string, status: RoomView['status'], gameId?: string): RoomView => ({
  code,
  hostId: 'h',
  status,
  maxPlayers: 5,
  members: [{ userId: 'h', displayName: 'h', isGuest: false, seat: 0, ready: false }],
  settings,
  ...(gameId ? { gameId } : {}),
});

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getPublicRooms.mockResolvedValue([]);
    useSession.setState({ user: { ...signedIn } });
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the lobby for a signed-in user', () => {
    render(<HomeScreen />);
    expect(screen.getByRole('button', { name: '建立房間' })).toBeInTheDocument();
  });

  it('renders nothing while signed out (the router redirects to /login)', () => {
    useSession.setState({ user: null });
    const { container } = render(<HomeScreen />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists public rooms with Join (lobby) and Watch (live) actions', async () => {
    mocked.getPublicRooms.mockResolvedValue([
      pubRoom('LOBBYY', 'LOBBY'),
      pubRoom('LIVEEE', 'STARTED', 'g1'),
    ]);
    render(<HomeScreen />);
    await screen.findByText('LOBBYY');
    expect(screen.getAllByRole('button', { name: '加入房間' }).length).toBeGreaterThan(0);
    const watch = await screen.findByRole('button', { name: '觀戰' });
    fireEvent.click(watch);
    await waitFor(() => expect(mocked.spectate).toHaveBeenCalledWith('LIVEEE'));
  });
});
