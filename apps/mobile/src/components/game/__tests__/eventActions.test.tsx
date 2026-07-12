// The mobile analogue of the web's GameStage.events.test.tsx: every expansion-event affordance
// routes to its command, with the same snapshot-derived gating as the web controls.
import { render, fireEvent } from '@testing-library/react-native';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { CardColor as PbCardColor, GameSnapshotSchema, Phase } from '@trm/proto';
import '../../../i18n';
import type { GameCommands } from '../../../net/commands';
import { EventPhaseBar, EventTurnActions } from '../EventActions';

const commandSpies = () =>
  ({
    relocateLanternHost: jest.fn(),
    repairRoute: jest.fn(),
    nightMarketSwap: jest.fn(),
    chooseEventPerk: jest.fn(),
    startHiveDraw: jest.fn(),
    continueHiveDraw: jest.fn(),
    stopHiveDraw: jest.fn(),
  }) as unknown as GameCommands;

function snap(
  phase: Phase,
  randomEvents: MessageInitShape<typeof GameSnapshotSchema>['randomEvents'],
  opts: { market?: PbCardColor[] } = {},
) {
  return create(GameSnapshotSchema, {
    stateVersion: 1,
    phase,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    deckCount: 10,
    market: opts.market ?? [PbCardColor.BLUE, PbCardColor.GREEN, PbCardColor.YELLOW],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 4 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: { playerId: 'p0', hand: { red: 2 }, keptTicketIds: [], pendingOfferTicketIds: [] },
    randomEvents,
  });
}

describe('EventPhaseBar', () => {
  it('lantern relocation: a candidate city button relocates the host', () => {
    const commands = commandSpies();
    const s = snap(Phase.LANTERN_RELOCATION, {
      mode: 'intense',
      lanternHost: { eventId: 'lantern', cityId: 'taipei', points: 6 },
      lanternPendingRelocation: { playerId: 'p0', candidateCityIds: ['kaohsiung'] },
    });
    const { getByText } = render(
      <EventPhaseBar snapshot={s} commands={commands} locale="zh-Hant" />,
    );
    fireEvent.press(getByText('高雄'));
    expect(commands.relocateLanternHost).toHaveBeenCalledWith('kaohsiung');
  });

  it('rolling-stock draft: a perk button chooses that perk', () => {
    const commands = commandSpies();
    const s = snap(Phase.EVENT_DRAFT, {
      mode: 'intense',
      eventDraft: { order: ['p0', 'p1'], pickIndex: 0, currentPlayerId: 'p0' },
    });
    const { getByText } = render(
      <EventPhaseBar snapshot={s} commands={commands} locale="zh-Hant" />,
    );
    fireEvent.press(getByText('立即抽 2 張'));
    expect(commands.chooseEventPerk).toHaveBeenCalledWith('DRAW_TWO');
  });

  it('hive draw: shows the reveal progress and stops on demand', () => {
    const commands = commandSpies();
    const s = snap(Phase.HIVE_DRAW, {
      mode: 'intense',
      pendingHiveDraw: {
        playerId: 'p0',
        revealed: [PbCardColor.RED, PbCardColor.BLUE],
        maxDraws: 4,
      },
    });
    const { getByText } = render(
      <EventPhaseBar snapshot={s} commands={commands} locale="zh-Hant" />,
    );
    expect(getByText(/2\/4/)).toBeTruthy();
    fireEvent.press(getByText('收手並保留'));
    expect(commands.stopHiveDraw).toHaveBeenCalledTimes(1);
  });

  it("another player's pending phase renders read-only", () => {
    const commands = commandSpies();
    const s = snap(Phase.HIVE_DRAW, {
      mode: 'intense',
      pendingHiveDraw: { playerId: 'p1', revealed: [], maxDraws: 4 },
    });
    const { getByText } = render(
      <EventPhaseBar snapshot={s} commands={commands} locale="zh-Hant" />,
    );
    fireEvent.press(getByText('收手並保留'));
    expect(commands.stopHiveDraw).not.toHaveBeenCalled();
  });
});

describe('EventTurnActions', () => {
  const activeEvents = {
    mode: 'intense',
    active: [
      { id: 'night', kind: 'STATION_FRONT_NIGHT_MARKET', cityId: 'taipei' },
      { id: 'slope', kind: 'SLOPE_REPAIR_ORDER', routeIds: ['R1'] },
      { id: 'hive', kind: 'HIVE_OF_SPARKS' },
      { id: 'seats', kind: 'ALL_SEATS_RESERVED' },
    ],
    closedRouteIds: ['R1'],
    repairedRouteIds: [],
    nightMarketSwapAvailable: true,
  } as MessageInitShape<typeof GameSnapshotSchema>['randomEvents'];

  it('offers hive start, the night-market swap (skipping the reserved locomotive slot), and named repairs', () => {
    const commands = commandSpies();
    const onRepair = jest.fn();
    const s = snap(Phase.AWAIT_ACTION, activeEvents, {
      market: [PbCardColor.LOCOMOTIVE, PbCardColor.BLUE, PbCardColor.GREEN, PbCardColor.YELLOW],
    });
    const { getByText, getByTestId } = render(
      <EventTurnActions
        snapshot={s}
        commands={commands}
        canAct
        locale="zh-Hant"
        onRepair={onRepair}
      />,
    );

    fireEvent.press(getByText('開始試膽'));
    expect(commands.startHiveDraw).toHaveBeenCalledTimes(1);

    // Defaults: first held colour (RED) and the first swappable slot — slot 0 is a face-up
    // locomotive, reserved while ALL_SEATS_RESERVED is active, so slot 1 is offered instead.
    fireEvent.press(getByTestId('night-swap-submit'));
    expect(commands.nightMarketSwap).toHaveBeenCalledWith('RED', 1);

    // The repair affordance names its route by endpoints (R1 = 臺北–板橋).
    fireEvent.press(getByText('搶修 臺北–板橋'));
    expect(onRepair).toHaveBeenCalledWith('R1');
  });

  it('renders nothing while the viewer cannot act', () => {
    const s = snap(Phase.AWAIT_ACTION, activeEvents);
    const { queryByTestId } = render(
      <EventTurnActions
        snapshot={s}
        commands={commandSpies()}
        canAct={false}
        locale="zh-Hant"
        onRepair={jest.fn()}
      />,
    );
    expect(queryByTestId('event-turn-actions')).toBeNull();
  });
});
