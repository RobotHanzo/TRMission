import { render, fireEvent, act } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import { ROUTES, TICKETS, ticketById } from '../../../game/content';
import { useAnimations } from '../../../store/animations';
import { useRoster } from '../../../store/roster';
import { useModeration } from '../../../store/moderation';
import { PlayerCard } from '../PlayerCard';
import { PlayerTrackers } from '../PlayerTrackers';

const doneTicket = TICKETS[0]!.id as string;
const gain = ticketById.get(doneTicket)!.value;
const mine = [ROUTES[0]!.id as string, ROUTES[1]!.id as string];

const snap = create(GameSnapshotSchema, {
  currentPlayerId: 'p1',
  players: [
    {
      id: 'p0',
      seat: 0,
      team: -1,
      trainCars: 4,
      routePoints: 30,
      handCount: 6,
      ticketCount: 2,
      stationsRemaining: 1,
    },
    { id: 'p1', seat: 1, team: -1, trainCars: 40, routePoints: 10, stationsRemaining: 3 },
  ],
  you: { playerId: 'p1' },
  completedTickets: [{ playerId: 'p0', ticketId: doneTicket }],
  stations: [{ playerId: 'p0', cityId: 'taichung' }],
  ownership: [
    { routeId: mine[0]!, cell: { case: 'ownerPlayerId', value: 'p0' } },
    { routeId: mine[1]!, cell: { case: 'ownerPlayerId', value: 'p0' } },
    { routeId: ROUTES[2]!.id as string, cell: { case: 'ownerPlayerId', value: 'p1' } },
  ],
});

beforeEach(() => {
  act(() => {
    useAnimations.getState().reset();
    useRoster.getState().clear();
    useModeration.setState({ blocked: new Set() });
  });
});

describe('PlayerCard (issue #14)', () => {
  it('splits the live score into route points and completed-mission value', () => {
    const { getByText } = render(<PlayerCard snapshot={snap} playerId="p0" onClose={jest.fn()} />);
    expect(getByText(String(30 + gain))).toBeTruthy();
    expect(getByText('30')).toBeTruthy();
  });

  it('warns that the endgame is close when the train supply runs low', () => {
    const { getByText } = render(<PlayerCard snapshot={snap} playerId="p0" onClose={jest.fn()} />);
    expect(getByText('即將觸發終局')).toBeTruthy();
  });

  it('lights only that player’s own routes on the board, and clears them again', () => {
    const { getByTestId } = render(
      <PlayerCard snapshot={snap} playerId="p0" onClose={jest.fn()} />,
    );
    fireEvent.press(getByTestId('player-card-reveal'));
    expect(useAnimations.getState().routeReveal).toEqual({ seat: 0, path: mine });
    // The body folds away while the network is lit — the point of the reveal is the board.
    fireEvent.press(getByTestId('player-card-reveal'));
    expect(useAnimations.getState().routeReveal).toBeNull();
  });

  it('drops the highlight when the card closes, so the board cannot keep glowing', () => {
    const { getByTestId, unmount } = render(
      <PlayerCard snapshot={snap} playerId="p0" onClose={jest.fn()} />,
    );
    fireEvent.press(getByTestId('player-card-reveal'));
    expect(useAnimations.getState().routeReveal).not.toBeNull();
    unmount();
    expect(useAnimations.getState().routeReveal).toBeNull();
  });

  it('renders nothing for an id that is not seated', () => {
    const { toJSON } = render(<PlayerCard snapshot={snap} playerId="ghost" onClose={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('offers no report action for a bot', () => {
    const bots = create(GameSnapshotSchema, {
      players: [{ id: 'bot:1', seat: 0, team: -1, trainCars: 45 }],
      you: { playerId: 'p1' },
    });
    const { queryByTestId } = render(
      <PlayerCard snapshot={bots} playerId="bot:1" onClose={jest.fn()} />,
    );
    expect(queryByTestId('player-card-report')).toBeNull();
  });
});

describe('PlayerTrackers rows (issue #14)', () => {
  it('opens the card for the row that was tapped', () => {
    const onInspect = jest.fn();
    const { getByTestId } = render(<PlayerTrackers snapshot={snap} onInspect={onInspect} />);
    fireEvent.press(getByTestId('tracker-p0'));
    expect(onInspect).toHaveBeenCalledWith('p0');
  });

  it('keeps the score and train cars on the row and drops the rest to the card', () => {
    const { getByText, queryByText } = render(<PlayerTrackers snapshot={snap} />);
    expect(getByText(String(30 + gain))).toBeTruthy(); // live score
    expect(getByText('4')).toBeTruthy(); // train cars
    expect(queryByText('6')).toBeNull(); // hand count no longer in the row
  });
});
