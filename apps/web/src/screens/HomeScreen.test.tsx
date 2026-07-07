import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { UserFeature } from '@trm/shared';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../i18n';
import { HomeScreen } from './HomeScreen';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api, type RoomView } from '../net/rest';

vi.mock('../net/connection', () => ({ connectGame: vi.fn() }));
vi.mock('../net/rest', () => ({
  setOnTokenChange: vi.fn(),
  setAccessToken: vi.fn(),
  api: {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    getRoom: vi.fn(),
    getPublicRooms: vi.fn(() => Promise.resolve([])),
    getMyRooms: vi.fn(() => Promise.resolve([])),
    spectate: vi.fn(() => Promise.resolve({ gameId: 'g', ticket: 't' })),
    history: vi.fn(() => Promise.resolve([{ role: 'player' }])),
  },
}));

const mocked = api as unknown as {
  getPublicRooms: ReturnType<typeof vi.fn>;
  getMyRooms: ReturnType<typeof vi.fn>;
  getRoom: ReturnType<typeof vi.fn>;
  spectate: ReturnType<typeof vi.fn>;
  joinRoom: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
};

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: [] as UserFeature[],
} as const;

const settings = {
  unlimitedStationBorrow: false,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
  doubleRouteSingleFor23: true,
  allowSpectating: true,
  visibility: 'PUBLIC' as const,
  map: { source: 'official' as const, mapId: 'taiwan' },
  eventsMode: 'off' as const,
};
const pubRoom = (code: string, status: RoomView['status'], gameId?: string): RoomView => ({
  code,
  hostId: 'h',
  status,
  maxPlayers: 5,
  members: [{ userId: 'h', displayName: 'h', isGuest: false, seat: 0, ready: false }],
  settings,
  spectators: [],
  chat: [],
  ...(gameId ? { gameId } : {}),
});

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getPublicRooms.mockResolvedValue([]);
    mocked.getMyRooms.mockResolvedValue([]);
    mocked.history.mockResolvedValue([{ role: 'player' }]);
    useSession.setState({ user: { ...signedIn } });
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the lobby for a signed-in user', async () => {
    render(<HomeScreen />);
    expect(await screen.findByRole('button', { name: '建立房間' })).toBeInTheDocument();
    expect(screen.getByText('歡迎回來，Tester')).toBeInTheDocument();
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
    expect(screen.getAllByRole('button', { name: '加入' }).length).toBeGreaterThan(0);
    const watch = await screen.findByRole('button', { name: '觀戰' });
    fireEvent.click(watch);
    await waitFor(() => expect(mocked.spectate).toHaveBeenCalledWith('LIVEEE'));
  });

  it('spectates via the code box when the code targets a started, spectatable room', async () => {
    mocked.getRoom.mockResolvedValue(pubRoom('LIVEEE', 'STARTED', 'g9'));
    render(<HomeScreen />);
    const input = await screen.findByLabelText('輸入房號');
    fireEvent.change(input, { target: { value: 'liveee' } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await waitFor(() => expect(mocked.getRoom).toHaveBeenCalledWith('LIVEEE'));
    await waitFor(() => expect(mocked.spectate).toHaveBeenCalledWith('LIVEEE'));
    expect(mocked.joinRoom).not.toHaveBeenCalled();
  });

  it('shows a rejoin banner for the most recent active room and re-enters it', async () => {
    mocked.getMyRooms.mockResolvedValue([pubRoom('MYROOM', 'STARTED', 'g2')]);
    const original = useUi.getState().enterRoom;
    const enterRoom = vi.fn();
    useUi.setState({ enterRoom });
    try {
      render(<HomeScreen />);
      const rejoin = await screen.findByRole('button', { name: /回到房間 MYROOM/ });
      fireEvent.click(rejoin);
      expect(enterRoom).toHaveBeenCalledWith('MYROOM');
    } finally {
      useUi.setState({ enterRoom: original });
    }
  });

  it('shows no rejoin banner without an active room', async () => {
    render(<HomeScreen />);
    await waitFor(() => expect(mocked.getMyRooms).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /回到房間/ })).not.toBeInTheDocument();
  });

  it('shows the first-entry welcome screen for a brand-new account (0 completed games)', async () => {
    mocked.history.mockResolvedValue([]);
    const enterTutorial = vi.fn();
    const original = useUi.getState().enterTutorial;
    useUi.setState({ enterTutorial });
    try {
      render(<HomeScreen />);
      const startTutorial = await screen.findByRole('button', { name: /開始教學/ });
      expect(screen.queryByText('歡迎回來，Tester')).not.toBeInTheDocument();
      fireEvent.click(startTutorial);
      expect(enterTutorial).toHaveBeenCalled();
    } finally {
      useUi.setState({ enterTutorial: original });
    }
  });

  it('a spectator-only history still counts as a new account', async () => {
    mocked.history.mockResolvedValue([{ role: 'spectator' }]);
    render(<HomeScreen />);
    expect(await screen.findByRole('button', { name: /前往首頁/ })).toBeInTheDocument();
  });

  it('lets a new account continue past the welcome screen to the homepage', async () => {
    mocked.history.mockResolvedValue([]);
    render(<HomeScreen />);
    const continueBtn = await screen.findByRole('button', { name: /前往首頁/ });
    fireEvent.click(continueBtn);
    await screen.findByText('歡迎回來，Tester');
  });
});
