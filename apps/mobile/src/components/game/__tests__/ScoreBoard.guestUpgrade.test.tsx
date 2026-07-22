import { fireEvent, render, screen } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { setActiveRoomContext } from '../../../game/activeRoom';
import type { PublicUser } from '../../../net/rest';
import { ScoreBoard } from '../ScoreBoard';

// The rating/celebration flows aren't under test here — keep them inert.
jest.mock('../../celebration/Confetti', () => ({ Confetti: () => null }));
jest.mock('../../../net/rest', () => ({
  api: { submitRating: jest.fn().mockResolvedValue(undefined) },
}));

// The guest-upgrade card is the surface under test; the session store itself (with its own
// push/moderation/secureStore dependency chain) is exercised by store/session.test.ts.
const mockUpgrade = jest.fn();
let mockUser: PublicUser | null = null;
jest.mock('../../../store/session', () => ({
  useSession: (selector: (s: unknown) => unknown) =>
    selector({ user: mockUser, loading: false, error: null, upgrade: mockUpgrade }),
}));

const guestUser: PublicUser = {
  id: 'g1',
  displayName: 'Guest',
  isGuest: true,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: [],
  tutorialCompleted: true,
};

const snap = (): GameSnapshot =>
  create(GameSnapshotSchema, {
    phase: Phase.GAME_OVER,
    players: [{ id: 'me', seat: 0 }],
    you: { playerId: 'me', hand: {}, keptTicketIds: [], pendingOfferTicketIds: [] },
    finalScores: {
      players: [{ playerId: 'me', total: 42, completedTicketIds: [], keptTicketIds: [] }],
      ranking: [{ playerIds: ['me'] }],
    },
  });

beforeEach(() => {
  mockUpgrade.mockReset();
  mockUser = null;
  setActiveRoomContext({ gameId: 'g1', roomCode: 'ABCD' });
});

afterEach(() => {
  setActiveRoomContext({});
});

describe('ScoreBoard guest upgrade', () => {
  it('offers a guest player the leaderboard-framed upgrade nudge', async () => {
    mockUser = guestUser;
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByTestId('scoreboard-guest-upgrade');
    expect(screen.getByText(/排行榜/)).toBeTruthy();
  });

  it('hides for a registered player', async () => {
    mockUser = { ...guestUser, isGuest: false };
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByTestId('scoreboard-discord');
    expect(screen.queryByTestId('scoreboard-guest-upgrade')).toBeNull();
  });

  it('hides outside an online room context (offline/sandbox)', async () => {
    setActiveRoomContext({});
    mockUser = guestUser;
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByTestId('scoreboard-discord');
    expect(screen.queryByTestId('scoreboard-guest-upgrade')).toBeNull();
  });

  it('expands into an email/password form and submits the upgrade', async () => {
    mockUser = guestUser;
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByTestId('scoreboard-guest-upgrade');

    fireEvent.press(screen.getByText('建立帳號'));
    fireEvent.changeText(screen.getByPlaceholderText('電子郵件'), 'a@b.com');
    fireEvent.changeText(screen.getByPlaceholderText('密碼'), 'password1');
    fireEvent.press(screen.getByText('建立帳號'));

    expect(mockUpgrade).toHaveBeenCalledWith('a@b.com', 'password1');
  });
});
