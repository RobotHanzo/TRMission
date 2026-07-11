import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { CardColor, GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import i18n from '../i18n';
import type { GameCommands } from '../net/commands';
import { useGame } from '../store/game';
import { GameStage } from './GameStage';

vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));

const commandSpies = () =>
  ({
    relocateLanternHost: vi.fn(),
    repairRoute: vi.fn(),
    nightMarketSwap: vi.fn(),
    chooseEventPerk: vi.fn(),
    startHiveDraw: vi.fn(),
    continueHiveDraw: vi.fn(),
    stopHiveDraw: vi.fn(),
  }) as unknown as GameCommands;

function snap(
  phase: Phase,
  randomEvents: MessageInitShape<typeof GameSnapshotSchema>['randomEvents'],
  opts: { hand?: MessageInitShape<typeof GameSnapshotSchema>['you']; market?: CardColor[] } = {},
) {
  return create(GameSnapshotSchema, {
    stateVersion: 1,
    phase,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    deckCount: 10,
    ticketDeckShortCount: 5,
    market: opts.market ?? [CardColor.BLUE, CardColor.GREEN, CardColor.YELLOW, CardColor.BLACK],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 4 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: opts.hand ?? {
      playerId: 'p0',
      hand: { red: 2 },
      keptTicketIds: [],
      pendingOfferTicketIds: [],
    },
    randomEvents,
  });
}

beforeEach(() => {
  void i18n.changeLanguage('zh-Hant');
  useGame.getState().reset();
});

describe('GameStage expansion-event controls', () => {
  it('routes every mandatory phase control to its command and shows Hive reveal cards', () => {
    const lanternCommands = commandSpies();
    const lantern = snap(Phase.LANTERN_RELOCATION, {
      mode: 'intense',
      lanternHost: { eventId: 'lantern', cityId: 'taipei', points: 6 },
      lanternPendingRelocation: { playerId: 'p0', candidateCityIds: ['kaohsiung'] },
    });
    const { unmount } = render(
      <GameStage snapshot={lantern} commands={lanternCommands} onLeave={() => {}} sandbox />,
    );
    fireEvent.click(screen.getByRole('button', { name: '高雄' }));
    expect(lanternCommands.relocateLanternHost).toHaveBeenCalledWith('kaohsiung');
    expect(document.querySelector('.game-board > .event-action-bar')).not.toBeNull();
    unmount();

    const draftCommands = commandSpies();
    const draft = snap(Phase.EVENT_DRAFT, {
      mode: 'intense',
      eventDraft: { order: ['p0', 'p1'], pickIndex: 0, currentPlayerId: 'p0' },
    });
    const draftView = render(
      <GameStage snapshot={draft} commands={draftCommands} onLeave={() => {}} sandbox />,
    );
    fireEvent.click(screen.getByRole('button', { name: '立即抽 2 張' }));
    expect(draftCommands.chooseEventPerk).toHaveBeenCalledWith('DRAW_TWO');
    draftView.unmount();

    const hiveCommands = commandSpies();
    const hive = snap(Phase.HIVE_DRAW, {
      mode: 'intense',
      pendingHiveDraw: {
        playerId: 'p0',
        revealed: [CardColor.RED, CardColor.BLUE],
        maxDraws: 4,
      },
    });
    render(<GameStage snapshot={hive} commands={hiveCommands} onLeave={() => {}} sandbox />);
    expect(document.querySelectorAll('.event-hive-cards .train-card')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '收手並保留' }));
    expect(hiveCommands.stopHiveDraw).toHaveBeenCalledTimes(1);
  });

  it('offers free night-market swaps, slope repairs, Hive starts, and blocks reserved locomotives', () => {
    const commands = commandSpies();
    const state = snap(
      Phase.AWAIT_ACTION,
      {
        mode: 'intense',
        active: [
          { id: 'night', kind: 'STATION_FRONT_NIGHT_MARKET', cityId: 'taipei' },
          { id: 'slope', kind: 'SLOPE_REPAIR_ORDER', routeIds: ['R1'] },
          { id: 'hive', kind: 'HIVE_OF_SPARKS' },
          { id: 'seats', kind: 'ALL_SEATS_RESERVED' },
        ],
        closedRouteIds: ['R1'],
        nightMarketSwapAvailable: true,
      },
      {
        market: [CardColor.LOCOMOTIVE, CardColor.BLUE, CardColor.GREEN, CardColor.YELLOW],
      },
    );
    render(<GameStage snapshot={state} commands={commands} onLeave={() => {}} sandbox />);

    expect(document.querySelector('[data-slot="0"]')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '逛夜市換牌' }));
    expect(commands.nightMarketSwap).toHaveBeenCalledWith('RED', 1);
    fireEvent.click(screen.getByRole('button', { name: '開始試膽' }));
    expect(commands.startHiveDraw).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '搶修封閉路線' }));
    fireEvent.click(document.querySelector('.payment-card')!);
    expect(commands.repairRoute).toHaveBeenCalledWith(
      'R1',
      expect.objectContaining({ color: CardColor.RED, colorCount: 2, locomotives: 0 }),
    );
  });
});
