// Ports the web GameStage.gate.test.tsx semantics to the mobile stage: the tutorial action gate
// must gate claiming and station-building INDEPENDENTLY, and — when a beat names a specific
// route/city — only THAT target may open the payment dialog. The Skia board is replaced by a
// prop-capturing stub; taps are driven through the captured onPickRoute/onPickCity exactly as
// BoardView's hit-test dispatch would deliver them. The observable is `onPendingClaim` (the
// tutorial pay-hint hook): it reports 'route'/'station' the moment the payment picker opens and
// null while it stays shut.
import { render, act, fireEvent, screen } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../i18n'; // side-effect i18next init (zh-Hant default)
import { CITIES, ROUTES } from '../game/content';
import type { BoardViewProps } from '../board/BoardView';
import type { ActionGate } from '../game/actionGate';
import { GameStage } from './GameStage';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: jest.fn() }));
jest.mock('../hooks/useSoundDriver', () => ({ useSoundDriver: jest.fn() }));
jest.mock('../game/useHaptics', () => ({ useHaptics: jest.fn() }));

let mockBoardProps: BoardViewProps | null = null;
jest.mock('../board/BoardView', () => ({
  BoardView: (props: BoardViewProps) => {
    mockBoardProps = props;
    return null;
  },
}));

// Two distinct plain colour routes + two cities; an all-locomotive hand pays for any of them, so
// the ONLY thing that can stop the payment dialog from opening is the gate.
const routeA = ROUTES.find((r) => !r.isTunnel && r.ferryLocos === 0 && r.color !== 'GRAY')!;
const routeB = ROUTES.find(
  (r) => r.id !== routeA.id && !r.isTunnel && r.ferryLocos === 0 && r.color !== 'GRAY',
)!;
const cityA = CITIES[0].id as string;
const cityB = CITIES[1].id as string;

const payableSnap = (): GameSnapshot =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    deckCount: 10,
    ticketDeckShortCount: 5,
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 9 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: { playerId: 'p0', hand: { locomotive: 9 }, keptTicketIds: [], pendingOfferTicketIds: [] },
  });

const renderStage = (gate?: ActionGate) => {
  const onPendingClaim = jest.fn();
  render(
    <GameStage
      snapshot={payableSnap()}
      commands={null}
      onLeave={() => {}}
      sandbox
      actionGate={gate}
      onPendingClaim={onPendingClaim}
    />,
  );
  return onPendingClaim;
};

beforeEach(() => {
  mockBoardProps = null;
});

describe('GameStage tutorial action gate wiring', () => {
  it('with no gate (live game) both board affordances stay live', () => {
    renderStage();
    expect(mockBoardProps?.canClaim).toBe(true);
    expect(mockBoardProps?.canBuildStation).toBe(true);
  });

  it('a locked gate (narration / info beat) disables both board affordances', () => {
    renderStage('locked');
    expect(mockBoardProps?.canClaim).toBe(false);
    expect(mockBoardProps?.canBuildStation).toBe(false);
  });

  it('a CLAIM_ROUTE gate keeps claiming live but stations dead — and vice versa', () => {
    renderStage({ t: 'CLAIM_ROUTE' });
    expect(mockBoardProps?.canClaim).toBe(true);
    expect(mockBoardProps?.canBuildStation).toBe(false);

    renderStage({ t: 'BUILD_STATION' });
    expect(mockBoardProps?.canClaim).toBe(false);
    expect(mockBoardProps?.canBuildStation).toBe(true);
  });

  it('a CLAIM_ROUTE gate naming one route ignores a tap on a different route', () => {
    const onPendingClaim = renderStage({ t: 'CLAIM_ROUTE', routeId: routeA.id as string });
    act(() => mockBoardProps!.onPickRoute(routeB.id as string));
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
    act(() => mockBoardProps!.onPickRoute(routeA.id as string));
    expect(onPendingClaim).toHaveBeenLastCalledWith('route');
  });

  it('a BUILD_STATION gate naming one city ignores a tap on a different city', () => {
    const onPendingClaim = renderStage({ t: 'BUILD_STATION', cityId: cityA });
    act(() => mockBoardProps!.onPickCity(cityB));
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
    act(() => mockBoardProps!.onPickCity(cityA));
    expect(onPendingClaim).toHaveBeenLastCalledWith('station');
  });

  it('a CLAIM_ROUTE gate leaves every city un-tappable (not just the wrong-station case)', () => {
    const onPendingClaim = renderStage({ t: 'CLAIM_ROUTE', routeId: routeA.id as string });
    act(() => mockBoardProps!.onPickCity(cityA));
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
  });

  it('a BUILD_STATION gate leaves every route un-tappable (not just the wrong-route case)', () => {
    const onPendingClaim = renderStage({ t: 'BUILD_STATION', cityId: cityA });
    act(() => mockBoardProps!.onPickRoute(routeA.id as string));
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
  });

  it('reports the payment dialog opening and closing through onPendingClaim', () => {
    const onPendingClaim = renderStage({ t: 'CLAIM_ROUTE', routeId: routeA.id as string });
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
    act(() => mockBoardProps!.onPickRoute(routeA.id as string));
    expect(onPendingClaim).toHaveBeenLastCalledWith('route');
    fireEvent.press(screen.getByTestId('payment-backdrop')); // cancel
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
  });
});
