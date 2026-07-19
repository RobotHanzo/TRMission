import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { UserFeature } from '@trm/shared';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../i18n';
import { HomeScreen } from './HomeScreen';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useAnimations } from '../store/animations';
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
    startPractice: vi.fn(() => Promise.resolve({ code: 'PRAC01', gameId: 'gp', ticket: 'tp' })),
    history: vi.fn(() => Promise.resolve([{ role: 'player' }])),
  },
}));

const mocked = api as unknown as {
  getPublicRooms: ReturnType<typeof vi.fn>;
  getMyRooms: ReturnType<typeof vi.fn>;
  getRoom: ReturnType<typeof vi.fn>;
  spectate: ReturnType<typeof vi.fn>;
  startPractice: ReturnType<typeof vi.fn>;
  joinRoom: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
};

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: [] as UserFeature[],
  tutorialCompleted: true,
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
  soloWaitForHost: true,
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
    useAnimations.getState().reset();
    mocked.getPublicRooms.mockResolvedValue([]);
    mocked.getMyRooms.mockResolvedValue([]);
    mocked.history.mockResolvedValue([{ role: 'player' }]);
    useSession.setState({ user: { ...signedIn } });
    window.history.replaceState(null, '', '/');
    useUi.setState({ view: 'home', roomCode: null, gameId: null, ticket: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the lobby for a signed-in user', async () => {
    render(<HomeScreen />);
    expect(await screen.findByRole('button', { name: '建立房間' })).toBeInTheDocument();
    expect(screen.getByText('歡迎回來，Tester')).toBeInTheDocument();
  });

  it('renders nothing while signed out (App swaps in the landing page on this view)', () => {
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
    // roomCode/URL must be set the same way a lobby join would set them — GameScreen's roster
    // fetch (real player names instead of "P{seat+1}") and reload restoration both key off this.
    await waitFor(() => expect(useUi.getState().roomCode).toBe('LIVEEE'));
    expect(window.location.pathname).toBe('/room/LIVEEE');
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
    await waitFor(() => expect(useUi.getState().roomCode).toBe('LIVEEE'));
    expect(window.location.pathname).toBe('/room/LIVEEE');
  });

  it('joins a full lobby as a spectator and shows a one-time notice', async () => {
    mocked.getRoom.mockResolvedValue(pubRoom('FULLXX', 'LOBBY'));
    mocked.joinRoom.mockResolvedValue({
      ...pubRoom('FULLXX', 'LOBBY'),
      members: [{ userId: 'h', displayName: 'h', isGuest: false, seat: 0, ready: false }],
      spectators: [{ userId: 'u1', displayName: 'Tester', isGuest: false }],
    });
    render(<HomeScreen />);
    const input = await screen.findByLabelText('輸入房號');
    fireEvent.change(input, { target: { value: 'fullxx' } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await waitFor(() => expect(mocked.joinRoom).toHaveBeenCalledWith('FULLXX'));
    await waitFor(() =>
      expect(useAnimations.getState().notifications).toEqual([
        expect.objectContaining({ variant: 'notice', text: '房間已滿，你已加入為觀戰者。' }),
      ]),
    );
    expect(useUi.getState().roomCode).toBe('FULLXX');
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

  it('starts a practice game with bots from the welcome screen', async () => {
    mocked.history.mockResolvedValue([]); // brand-new account → welcome screen shows
    render(<HomeScreen />);
    const practice = await screen.findByRole('button', { name: /開始練習/ });
    fireEvent.click(practice);
    await waitFor(() => expect(mocked.startPractice).toHaveBeenCalled());
    // Same navigation contract as watch(): roomCode + /room/:code URL, then the game view.
    await waitFor(() => expect(useUi.getState().roomCode).toBe('PRAC01'));
    await waitFor(() => expect(useUi.getState().gameId).toBe('gp'));
    expect(window.location.pathname).toBe('/room/PRAC01');
  });

  it('recommends the tutorial before practicing without having completed it, but allows continuing', async () => {
    mocked.history.mockResolvedValue([]);
    useSession.setState({ user: { ...signedIn, tutorialCompleted: false } });
    render(<HomeScreen />);
    const practice = await screen.findByRole('button', { name: /開始練習/ });
    fireEvent.click(practice);
    expect(mocked.startPractice).not.toHaveBeenCalled();
    const continueAnyway = await screen.findByRole('button', { name: '直接繼續' });
    fireEvent.click(continueAnyway);
    await waitFor(() => expect(mocked.startPractice).toHaveBeenCalled());
  });

  it('recommends the tutorial before jumping in, and can route there instead', async () => {
    mocked.history.mockResolvedValue([]);
    useSession.setState({ user: { ...signedIn, tutorialCompleted: false } });
    const enterTutorial = vi.fn();
    const original = useUi.getState().enterTutorial;
    useUi.setState({ enterTutorial });
    try {
      render(<HomeScreen />);
      const continueBtn = await screen.findByRole('button', { name: /前往首頁/ });
      fireEvent.click(continueBtn);
      expect(screen.queryByText('歡迎回來，Tester')).not.toBeInTheDocument();
      const goToTutorial = await screen.findByRole('button', { name: '前往教學' });
      fireEvent.click(goToTutorial);
      expect(enterTutorial).toHaveBeenCalled();
    } finally {
      useUi.setState({ enterTutorial: original });
    }
  });
});
