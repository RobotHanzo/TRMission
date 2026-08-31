// Issue #79: the phone dock's tab layout. There is no Draw tab — the train-card deck + face-up
// market sit in the Cards tab with the hand they feed (which collapses to its brief reading so
// both fit), and the mission deck's draw button sits in the Missions tab with the missions it
// deals. The tutorial follows the same map: a beat awaiting a deck action opens the tab that deck
// now lives in. Same recipe as GameStage.gate.test.tsx — the Skia board is a stub; here the window
// is also narrowed to the compact tier, since the dock only exists below 700dp.
import { render, screen, fireEvent, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { create } from '@bufbuild/protobuf';
import { CardColor as PbCardColor, GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../i18n'; // side-effect i18next init (zh-Hant default)
import type { ActionGate } from '../game/actionGate';
import { GameStage } from './GameStage';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: jest.fn() }));
jest.mock('../hooks/useSoundDriver', () => ({ useSoundDriver: jest.fn() }));
jest.mock('../game/useHaptics', () => ({ useHaptics: jest.fn() }));
jest.mock('../board/BoardView', () => ({ BoardView: () => null }));

// A phone-width window, so stageTier() lands on 'compact' and the bottom dock renders.
beforeEach(() => {
  jest
    .spyOn(Dimensions, 'get')
    .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
});
afterEach(() => jest.restoreAllMocks());

const snap = (): GameSnapshot =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    market: [
      PbCardColor.RED,
      PbCardColor.BLUE,
      PbCardColor.GREEN,
      PbCardColor.LOCOMOTIVE,
      PbCardColor.WHITE,
    ],
    deckCount: 10,
    ticketDeckShortCount: 5,
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 4 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: {
      playerId: 'p0',
      hand: { red: 3, blue: 1 },
      keptTicketIds: [],
      pendingOfferTicketIds: [],
    },
  });

const renderStage = (gate?: ActionGate) =>
  render(
    <GameStage snapshot={snap()} commands={null} onLeave={() => {}} sandbox actionGate={gate} />,
  );

/** The mission-deck button, labelled with what's left in the deck. */
const drawMissions = () => screen.queryByText('抽任務卡 (5)');

describe('phone dock tabs (issue #79)', () => {
  it('has no Draw tab — one tab per deck, beside what it deals', async () => {
    await renderStage();
    // The first Text in each tab is its label (a count pill may follow). Sandbox drops chat.
    const labels = screen
      .getAllByRole('tab')
      .map((tab) => within(tab).getAllByText(/.+/)[0]?.props.children);
    expect(labels).toEqual(['手牌', '任務卡', '玩家', '紀錄']);
  });

  it('opens on the Cards tab, holding the train-card deck and the hand together', async () => {
    await renderStage();
    expect(screen.getByTestId('market-deck')).toBeTruthy();
    expect(screen.getByTestId('market-slot-0')).toBeTruthy();
    expect(screen.getByTestId('hand-brief-toggle')).toBeTruthy();
    // The mission deck is NOT here — it moved to the Missions tab.
    expect(drawMissions()).toBeNull();
  });

  it('carries the mission-deck button in the Missions tab', async () => {
    await renderStage();
    await fireEvent.press(screen.getByText('任務卡'));
    expect(drawMissions()).toBeTruthy();
    expect(screen.queryByTestId('market-deck')).toBeNull();
  });

  it('collapses the hand to its brief reading and back', async () => {
    await renderStage();
    const toggle = screen.getByTestId('hand-brief-toggle');
    const widths = () => screen.getAllByLabelText(/×\d/).map((n) => n.props.style.width);
    expect(widths()).toEqual([92, 92]);
    await fireEvent.press(toggle);
    expect(widths()).toEqual([56, 56]);
    // The market above it is untouched — collapsing the hand is what keeps it on screen.
    expect(screen.getByTestId('market-deck')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('hand-brief-toggle'));
    expect(widths()).toEqual([92, 92]);
  });
});

describe('the tutorial dock follows each deck to its new tab', () => {
  it('a market-draw beat surfaces the Cards tab', async () => {
    await renderStage({ t: 'DRAW_ANY' });
    expect(screen.getByTestId('market-deck')).toBeTruthy();
  });

  it('a mission-draw beat surfaces the Missions tab', async () => {
    await renderStage({ t: 'DRAW_TICKETS' });
    expect(drawMissions()).toBeTruthy();
  });

  it('a board beat tucks the dock away instead of picking a tab', async () => {
    const { rerender } = await renderStage({ t: 'DRAW_TICKETS' });
    expect(drawMissions()).toBeTruthy();
    await rerender(
      <GameStage
        snapshot={snap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate={{ t: 'CLAIM_ROUTE' }}
      />,
    );
    // Still mounted (the dock clips it while collapsed) — the tab choice simply stops changing.
    expect(drawMissions()).toBeTruthy();
  });
});
