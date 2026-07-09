import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { EventsPanel } from './EventsPanel';
import { useGame } from '../store/game';
import { useAnimations } from '../store/animations';

const snapshot = (randomEvents?: MessageInitShape<typeof GameSnapshotSchema>['randomEvents']) =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p1',
    turnOrder: ['p1', 'p2'],
    players: [
      { id: 'p1', seat: 0, trainCars: 45, stationsRemaining: 3 },
      { id: 'p2', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    ...(randomEvents ? { randomEvents } : {}),
  });

beforeEach(() => {
  useGame.getState().reset();
  useAnimations.getState().reset();
});

describe('EventsPanel', () => {
  it('renders active, charter, forecast and free-station rows from the snapshot', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [
          { id: 'ev1', kind: 'TYPHOON_LANDFALL', routeIds: ['r1', 'r2'], endsAfterRound: 4 },
        ],
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 12,
            expiresAfterRound: 6,
            wonByPlayerId: '',
          },
        ],
        forecast: { id: 'f1', kind: 'SKY_LANTERN', startRound: 3, durationRounds: 2 },
        freeStationAvailable: true,
      }),
    });
    render(<EventsPanel />);

    expect(screen.getByText('事件')).toBeInTheDocument(); // panel title
    expect(screen.getByText('強烈')).toBeInTheDocument(); // intensity chip
    // Active typhoon: localized name, affected route count, and rounds-left (4 − 2 + 1 = 3).
    expect(screen.getByText('颱風登陸')).toBeInTheDocument();
    expect(screen.getByText('2 條路線')).toBeInTheDocument();
    expect(screen.getByText('剩 3 輪')).toBeInTheDocument();
    // Open charter with resolved city names + points.
    expect(screen.getByText(/臺北–高雄.*12/)).toBeInTheDocument();
    // One-round forecast (dimmed row).
    expect(screen.getByText('預報')).toBeInTheDocument();
    expect(screen.getByText('天燈之夜')).toBeInTheDocument();
    expect(screen.getByText('下一輪開始')).toBeInTheDocument();
    // Gala free-station window.
    expect(screen.getByText('本輪首座車站免費')).toBeInTheDocument();
  });

  it('shows the "completed" state for a won charter', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'light',
        roundIndex: 1,
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 9,
            expiresAfterRound: 5,
            wonByPlayerId: 'p2',
          },
        ],
      }),
    });
    render(<EventsPanel />);
    expect(screen.getByText(/完成觀光專列/)).toBeInTheDocument();
  });

  it('renders nothing when the snapshot carries no random_events block', () => {
    useGame.setState({ snapshot: snapshot() });
    render(<EventsPanel />);
    expect(screen.queryByTestId('events-panel')).toBeNull();
  });

  it("opens the description modal from an active event's info button", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [
          { id: 'ev1', kind: 'TYPHOON_LANDFALL', routeIds: ['r1', 'r2'], endsAfterRound: 4 },
        ],
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('颱風登陸')).toBeInTheDocument();
    expect(
      within(dialog).getByText('封閉部分路線；恢復通車後首位鋪設者可得 +2 分'),
    ).toBeInTheDocument();
    // 'r1'/'r2' aren't real route ids — the affected-routes section has nothing resolvable, so
    // it doesn't render at all (regression: no stray empty section).
    expect(within(dialog).queryByText('受影響路線')).toBeNull();
  });

  it("opens the description modal from a charter row's info button", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'light',
        roundIndex: 1,
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 12,
            expiresAfterRound: 6,
            wonByPlayerId: '',
          },
        ],
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('觀光專開列車')).toBeInTheDocument();
    expect(within(dialog).getByText('以自己的路網連接指定兩座城市即可得分')).toBeInTheDocument();
  });

  it("opens the description modal from the forecast row's info button", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'moderate',
        roundIndex: 3,
        forecast: { id: 'f1', kind: 'SKY_LANTERN', startRound: 3, durationRounds: 2 },
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('天燈之夜')).toBeInTheDocument();
    expect(
      within(dialog).getByText('指定路線分數加倍，但佔領需多付一張車廂卡'),
    ).toBeInTheDocument();
  });

  it('closes the description modal via the close button, backdrop click, and Escape', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [
          { id: 'ev1', kind: 'TYPHOON_LANDFALL', routeIds: ['r1', 'r2'], endsAfterRound: 4 },
        ],
      }),
    });
    const { container } = render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('關閉'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('查看'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.modal-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('查看'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not show an info button on the free-station banner row', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 1,
        freeStationAvailable: true,
      }),
    });
    render(<EventsPanel />);
    const freeRow = screen.getByText('本輪首座車站免費').closest('.event-row') as HTMLElement;
    expect(within(freeRow).queryByLabelText('查看')).toBeNull();
  });

  it("lists unclaimed affected routes on an active event's info modal, and pans the board on click", () => {
    useGame.setState({
      snapshot: create(GameSnapshotSchema, {
        stateVersion: 1,
        phase: Phase.AWAIT_ACTION,
        currentPlayerId: 'p1',
        turnOrder: ['p1', 'p2'],
        players: [
          { id: 'p1', seat: 0, trainCars: 45, stationsRemaining: 3 },
          { id: 'p2', seat: 1, trainCars: 45, stationsRemaining: 3 },
        ],
        // R1 (臺北–板橋) is already claimed — it must be excluded from the list.
        ownership: [{ routeId: 'R1', cell: { case: 'ownerPlayerId', value: 'p1' } }],
        randomEvents: {
          mode: 'intense',
          roundIndex: 2,
          active: [
            {
              id: 'ev1',
              kind: 'SKY_LANTERN',
              routeIds: ['R3', 'R65', 'R1'],
              endsAfterRound: 4,
            },
          ],
        },
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('受影響路線')).toBeInTheDocument();
    expect(within(dialog).getByText('臺北–基隆')).toBeInTheDocument(); // R3, taipei–keelung
    expect(within(dialog).getByText('臺北–平溪')).toBeInTheDocument(); // R65, taipei–pingxi
    expect(within(dialog).queryByText('臺北–板橋')).toBeNull(); // R1 — already owned, excluded

    fireEvent.click(within(dialog).getByText('臺北–基隆'));
    expect(screen.queryByRole('dialog')).toBeNull(); // clicking a route closes the modal
    expect(useAnimations.getState().eventSpotlight).toEqual({ kind: 'route', ids: ['R3'] });
  });

  it("also lists affected routes on the forecast row's info modal", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'moderate',
        roundIndex: 3,
        forecast: {
          id: 'f1',
          kind: 'SKY_LANTERN',
          startRound: 3,
          durationRounds: 2,
          routeIds: ['R3', 'R65'],
        },
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('受影響路線')).toBeInTheDocument();
    expect(within(dialog).getByText('臺北–基隆')).toBeInTheDocument();
    expect(within(dialog).getByText('臺北–平溪')).toBeInTheDocument();
  });

  it('does not show an affected-routes section for a non-route event kind', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [{ id: 'ev1', kind: 'AFTERSHOCK', endsAfterRound: 3 }],
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('餘震特報')).toBeInTheDocument();
    expect(within(dialog).queryByText('受影響路線')).toBeNull();
  });
});
