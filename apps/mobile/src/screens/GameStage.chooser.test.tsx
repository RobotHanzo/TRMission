// While the ticket chooser owns the rail, the pane tiers lose the players panel that normally
// carries the per-turn countdown — but a mid-game keep IS on the clock (the server auto-keeps the
// whole offer when it lapses), so the stage floats the countdown over the board instead. It must
// still mount exactly ONCE: the shared hook drives the warning-tick and time's-up sounds.
// Same recipe as GameStage.players.test.tsx (jest's default window is two-pane).
import { render, screen } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../i18n'; // side-effect i18next init (zh-Hant default)
import { GameStage } from './GameStage';
import { ticketById } from '../game/content';
import { useGame } from '../store/game';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: jest.fn() }));
jest.mock('../hooks/useSoundDriver', () => ({ useSoundDriver: jest.fn() }));
jest.mock('../game/useHaptics', () => ({ useHaptics: jest.fn() }));
jest.mock('../board/BoardView', () => ({ BoardView: () => null }));

const offered = [...ticketById.keys()].slice(0, 3);

const snap = (drafting: boolean): GameSnapshot =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: drafting ? Phase.TICKET_SELECTION : Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    deckCount: 10,
    ticketDeckShortCount: 5,
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 4 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: {
      playerId: 'p0',
      hand: {},
      keptTicketIds: [],
      pendingOfferTicketIds: drafting ? offered : [],
    },
  });

const arm = (s: GameSnapshot): void => {
  useGame.getState().reset();
  useGame.getState().applySnapshot(s);
  useGame.getState().applyTurnTimer('p0', 30_000, 75_000);
};

afterEach(() => useGame.getState().reset());

describe('GameStage countdown while drafting missions', () => {
  it('keeps exactly one countdown on screen while the chooser owns the rail', async () => {
    const s = snap(true);
    arm(s);
    await render(<GameStage snapshot={s} commands={null} onLeave={() => {}} />);
    expect(screen.getAllByTestId('turn-countdown')).toHaveLength(1);
  });

  it('still mounts exactly one when the rail carries its usual panels', async () => {
    const s = snap(false);
    arm(s);
    await render(<GameStage snapshot={s} commands={null} onLeave={() => {}} />);
    expect(screen.getAllByTestId('turn-countdown')).toHaveLength(1);
  });
});
