// Ports the web GameStage.tunnel.test.tsx semantics to the mobile stage: a pending tunnel reveal
// is a full-screen Modal, so in playback (no commands) it must be read-only AND closable — the
// replay transport sits underneath it, and its payment/abort buttons resolve nothing there
// (issue #45).
import { render, fireEvent, screen } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { CardColor, GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../i18n'; // side-effect i18next init (zh-Hant default)
import i18n from '../i18n';
import type { GameCommands } from '../net/commands';
import { GameStage } from './GameStage';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: jest.fn() }));
jest.mock('../hooks/useSoundDriver', () => ({ useSoundDriver: jest.fn() }));
jest.mock('../game/useHaptics', () => ({ useHaptics: jest.fn() }));
jest.mock('../board/BoardView', () => ({ BoardView: () => null }));
// Reduced motion shows the surcharge result instantly, so the assertions don't wait out the
// card-flip reveal.
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

const resolveTunnel = jest.fn();
const commandSpies = () => ({ resolveTunnel }) as unknown as GameCommands;

// p0 claimed a tunnel and owes 2 more; the viewer IS p0, so a live game would treat the reveal as
// theirs (interactive) — playback must not, since nothing there can resolve it.
const tunnelSnap = (): GameSnapshot =>
  create(GameSnapshotSchema, {
    stateVersion: 7,
    phase: Phase.TUNNEL_PENDING,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    deckCount: 10,
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 3 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: { playerId: 'p0', hand: { blue: 3 }, keptTicketIds: [], pendingOfferTicketIds: [] },
    pendingTunnel: {
      playerId: 'p0',
      routeId: 'r1',
      revealed: [CardColor.RED, CardColor.BLUE, CardColor.RED],
      extraRequired: 2,
      playedColor: CardColor.BLUE,
    },
  });

beforeEach(() => resolveTunnel.mockClear());

describe('GameStage tunnel reveal in playback', () => {
  it('a replay reveal is read-only and closes on demand, without resolving anything', async () => {
    await render(<GameStage snapshot={tunnelSnap()} commands={null} onLeave={() => {}} sandbox />);
    expect(screen.getByText(i18n.t('tunnel'))).toBeTruthy();
    // Read-only even though the viewed perspective is the claimant.
    expect(screen.queryByText(i18n.t('abort'))).toBeNull();

    await fireEvent.press(screen.getByText(i18n.t('close')));
    expect(screen.queryByText(i18n.t('tunnel'))).toBeNull();
    expect(resolveTunnel).not.toHaveBeenCalled();
  });

  it('a live claimant still gets the interactive dialog, and no Close', async () => {
    await render(
      <GameStage snapshot={tunnelSnap()} commands={commandSpies()} onLeave={() => {}} sandbox />,
    );
    expect(screen.queryByText(i18n.t('close'))).toBeNull();
    // The claimant's own way out stays the real action — it resolves the tunnel on the server.
    await fireEvent.press(screen.getByText(i18n.t('abort')));
    expect(resolveTunnel).toHaveBeenCalledWith(false);
  });
});
