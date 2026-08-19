import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { setActiveRoomContext } from '../../../game/activeRoom';
import { markGameRated } from '../../../game/ratedGames';
import { ScoreBoard } from '../ScoreBoard';

// What the App Store sheet is actually WORTH asking for is settled in game/appReview.test.ts.
// What this file pins down is the sequencing the scoreboard owns: the sheet must never race the
// in-app rating block, and must never follow a complaint.
const mockPrompt = jest.fn();
jest.mock('../../../game/appReview', () => ({
  useAppReviewPrompt: (finished: boolean, ready: boolean) => mockPrompt(finished, ready),
}));

jest.mock('../../celebration/Confetti', () => ({ Confetti: () => null }));

const mockSubmitRating = jest.fn();
jest.mock('../../../net/rest', () => ({
  api: { submitRating: (payload: unknown) => mockSubmitRating(payload) },
}));
jest.mock('../../../store/session', () => ({
  useSession: (selector: (s: unknown) => unknown) =>
    selector({ user: null, loading: false, error: null, upgrade: jest.fn() }),
}));

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

/** The (finished, ready) pair the scoreboard is currently asking the review prompt for. */
const lastCall = (): [boolean, boolean] => mockPrompt.mock.calls.at(-1) as [boolean, boolean];

beforeEach(async () => {
  await AsyncStorage.clear();
  mockPrompt.mockClear();
  mockSubmitRating.mockReset().mockResolvedValue(undefined);
  setActiveRoomContext({ gameId: 'g1', roomCode: 'ABCD' });
});

afterEach(() => {
  setActiveRoomContext({});
});

describe('ScoreBoard app review prompt', () => {
  it('waits for the in-app rating block, then asks once the game is rated well', async () => {
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} played />);
    await screen.findByTestId('scoreboard-rating');
    // The picker is still on screen and unanswered — the App Store sheet stays back.
    expect(lastCall()).toEqual([true, false]);

    fireEvent.press(screen.getByTestId('star-5'));
    fireEvent.press(screen.getByText('送出評分'));
    await waitFor(() => expect(lastCall()).toEqual([true, true]));
  });

  it('never hands a player who just complained to the App Store', async () => {
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} played />);
    await screen.findByTestId('scoreboard-rating');

    fireEvent.press(screen.getByTestId('star-2'));
    fireEvent.press(screen.getByText('送出評分'));
    await screen.findByText('感謝你的評分！');
    expect(lastCall()).toEqual([true, false]);
  });

  it('asks straight away for a game with no rating block (offline vs bots)', async () => {
    setActiveRoomContext({});
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} played />);
    await screen.findByTestId('scoreboard-discord');
    expect(lastCall()).toEqual([true, true]);
  });

  it('asks straight away for an already-rated game', async () => {
    await markGameRated('g1');
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} played />);
    await screen.findByText('感謝你的評分！');
    expect(lastCall()).toEqual([true, true]);
  });

  it('counts nothing and asks nothing for a replay or an encyclopedia clip', async () => {
    setActiveRoomContext({});
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByTestId('scoreboard-discord');
    expect(lastCall()).toEqual([false, false]);
  });
});
