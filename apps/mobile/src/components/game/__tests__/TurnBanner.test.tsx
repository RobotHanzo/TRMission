import { render, screen } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { TurnBanner } from '../TurnBanner';
import { useGame } from '../../../store/game';

const snap = (opts: { over?: boolean; mine?: boolean } = {}): GameSnapshot =>
  create(GameSnapshotSchema, {
    phase: opts.over ? Phase.GAME_OVER : Phase.AWAIT_ACTION,
    currentPlayerId: opts.mine === false ? 'p1' : 'me',
    players: [
      { id: 'me', seat: 0, trainCars: 45 },
      { id: 'p1', seat: 1, trainCars: 45 },
    ],
    you: { playerId: 'me', hand: {}, keptTicketIds: [], pendingOfferTicketIds: [] },
  });

beforeEach(() => {
  useGame.setState({ status: 'open' });
});

describe('TurnBanner', () => {
  it('announces my turn', () => {
    render(<TurnBanner snapshot={snap()} />);
    expect(screen.getByText('輪到你了')).toBeTruthy();
  });

  it("announces the acting opponent's turn by seat label", () => {
    render(<TurnBanner snapshot={snap({ mine: false })} />);
    expect(screen.getByText('輪到 P2')).toBeTruthy();
  });

  it('announces game over', () => {
    render(<TurnBanner snapshot={snap({ over: true })} />);
    expect(screen.getByText('遊戲結束')).toBeTruthy();
  });

  it('shows the connection chip while reconnecting — but never in a sandbox game', () => {
    useGame.setState({ status: 'reconnecting' });
    render(<TurnBanner snapshot={snap()} />);
    expect(screen.getByTestId('turn-banner-conn')).toBeTruthy();
    expect(screen.getByText('重新連線中…')).toBeTruthy();

    screen.unmount();
    render(<TurnBanner snapshot={snap()} sandbox />);
    expect(screen.queryByTestId('turn-banner-conn')).toBeNull();
  });
});
