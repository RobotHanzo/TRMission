import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { setActiveRoomContext } from '../../../game/activeRoom';
import { markGameRated } from '../../../game/ratedGames';
import { ScoreBoard } from '../ScoreBoard';

// The rating flow is the observable under test — the celebration visuals just need to not run
// timers/animations under jest.
jest.mock('../../celebration/Confetti', () => ({ Confetti: () => null }));

const mockSubmitRating = jest.fn();
jest.mock('../../../net/rest', () => ({
  api: { submitRating: (payload: unknown) => mockSubmitRating(payload) },
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

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSubmitRating.mockReset().mockResolvedValue(undefined);
  setActiveRoomContext({ gameId: 'g1', roomCode: 'ABCD' });
});

afterEach(() => {
  setActiveRoomContext({});
});

describe('ScoreBoard rating', () => {
  it('submits the picked stars once and dedupes for that game afterwards', async () => {
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByTestId('scoreboard-rating');

    fireEvent.press(screen.getByTestId('star-4'));
    fireEvent.press(screen.getByText('送出評分'));
    await waitFor(() =>
      expect(mockSubmitRating).toHaveBeenCalledWith({ gameId: 'g1', roomId: 'ABCD', stars: 4 }),
    );
    await screen.findByText('感謝你的評分！');

    // A fresh scoreboard for the SAME game skips straight to thanks (AsyncStorage dedupe).
    screen.unmount();
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByText('感謝你的評分！');
    expect(screen.queryByTestId('star-1')).toBeNull();
  });

  it('sends trimmed optional feedback text alongside the star rating', async () => {
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByTestId('scoreboard-rating');

    fireEvent.press(screen.getByTestId('star-5'));
    fireEvent.changeText(
      screen.getByPlaceholderText('想告訴我們更多嗎？（選填）'),
      '  Great game!  ',
    );
    fireEvent.press(screen.getByText('送出評分'));
    await waitFor(() =>
      expect(mockSubmitRating).toHaveBeenCalledWith({
        gameId: 'g1',
        roomId: 'ABCD',
        stars: 5,
        text: 'Great game!',
      }),
    );
  });

  it('shows thanks immediately for an already-rated game', async () => {
    await markGameRated('g1');
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByText('感謝你的評分！');
    expect(screen.queryByTestId('star-1')).toBeNull();
  });

  it('surfaces a submit failure and keeps the picker usable', async () => {
    mockSubmitRating.mockRejectedValueOnce(new Error('boom'));
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    await screen.findByTestId('scoreboard-rating');
    fireEvent.press(screen.getByTestId('star-2'));
    fireEvent.press(screen.getByText('送出評分'));
    await screen.findByText('評分送出失敗，請再試一次。');
    expect(screen.getByTestId('star-2')).toBeTruthy();
  });

  it('hides the rating block entirely without an online room context (offline/sandbox)', async () => {
    setActiveRoomContext({});
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    // The discord CTA still renders; the rating block never appears.
    await screen.findByTestId('scoreboard-discord');
    expect(screen.queryByTestId('scoreboard-rating')).toBeNull();
  });

  it('opens the community link from the Discord CTA', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    render(<ScoreBoard snapshot={snap()} onLeave={jest.fn()} />);
    fireEvent.press(await screen.findByTestId('scoreboard-discord'));
    expect(open).toHaveBeenCalledWith('https://trmission.robothanzo.dev/discord');
    open.mockRestore();
  });
});
