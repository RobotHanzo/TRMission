import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { EventsPanel } from './EventsPanel';
import { useGame } from '../store/game';

const snapshot = (
  randomEvents?: MessageInitShape<typeof GameSnapshotSchema>['randomEvents'],
) =>
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
});
