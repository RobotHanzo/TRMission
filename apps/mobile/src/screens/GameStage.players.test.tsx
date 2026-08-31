// Issue #66: the players panel must carry the timetable head from the design — its title plus the
// affordance for the player card, since a tracker row shows only two numbers and everything else
// is behind a tap. Same recipe as GameStage.gate.test.tsx: the Skia board is a prop-capturing stub.
import { render, screen } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../i18n'; // side-effect i18next init (zh-Hant default)
import { GameStage } from './GameStage';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: jest.fn() }));
jest.mock('../hooks/useSoundDriver', () => ({ useSoundDriver: jest.fn() }));
jest.mock('../game/useHaptics', () => ({ useHaptics: jest.fn() }));
jest.mock('../board/BoardView', () => ({ BoardView: () => null }));

const snap = (): GameSnapshot =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    deckCount: 10,
    ticketDeckShortCount: 5,
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 4 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: { playerId: 'p0', hand: {}, keptTicketIds: [], pendingOfferTicketIds: [] },
  });

describe('GameStage players panel head', () => {
  it('heads the panel with its title and the tap-for-details hint', async () => {
    await render(<GameStage snapshot={snap()} commands={null} onLeave={() => {}} sandbox />);
    expect(screen.getByText('玩家')).toBeTruthy();
    expect(screen.getByText('點一下查看詳情')).toBeTruthy();
  });
});
