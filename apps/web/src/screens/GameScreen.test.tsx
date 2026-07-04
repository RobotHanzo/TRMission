import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { GameScreen } from './GameScreen';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';

vi.mock('../net/connection', () => ({
  connectGame: vi.fn(),
  disconnectGame: vi.fn(),
  getSocket: () => null,
}));
vi.mock('../net/rest', () => ({
  setOnTokenChange: vi.fn(),
  setAccessToken: vi.fn(),
  api: { getRoom: vi.fn(() => Promise.resolve({ members: [] })) },
}));
vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));

// A spectator snapshot: players + turn state present, but no `you` (SelfView).
const spectatorSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
  });

describe('GameScreen spectator mode', () => {
  beforeEach(() => {
    useUi.setState({ view: 'game', ticket: 'tkt', roomCode: 'ABCD', gameId: 'g1' });
    useGame.setState({ snapshot: spectatorSnap(), rejection: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the spectating banner and disables actions when there is no SelfView', () => {
    render(<GameScreen />);
    expect(screen.getByText('觀戰中')).toBeInTheDocument();
    // The draw-tickets button carries a deck-count suffix, so match it loosely.
    expect(screen.getByRole('button', { name: /抽任務卡/ })).toBeDisabled();
  });
});

// A finished game: ScoreBoard's own leave button becomes GameScreen's `leave` (onLeave prop).
const gameOverSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.GAME_OVER,
    players: [
      { id: 'p0', seat: 0, routePoints: 10 },
      { id: 'p1', seat: 1, routePoints: 5 },
    ],
    you: { playerId: 'p0' },
    finalScores: {
      players: [
        {
          playerId: 'p0',
          routePoints: 10,
          ticketNet: 0,
          ticketsCompleted: 0,
          stationsUsed: 0,
          unusedStations: 3,
          stationBonus: 0,
          longestTrailLength: 0,
          longestBonus: 0,
          total: 10,
          keptTicketIds: [],
          completedTicketIds: [],
          longestTrailRouteIds: [],
        },
        {
          playerId: 'p1',
          routePoints: 5,
          ticketNet: 0,
          ticketsCompleted: 0,
          stationsUsed: 0,
          unusedStations: 3,
          stationBonus: 0,
          longestTrailLength: 0,
          longestBonus: 0,
          total: 5,
          keptTicketIds: [],
          completedTicketIds: [],
          longestTrailRouteIds: [],
        },
      ],
      ranking: [{ playerIds: ['p0'] }, { playerIds: ['p1'] }],
    },
  });

describe('GameScreen leave confirmation', () => {
  beforeEach(() => {
    useUi.setState({ view: 'game', ticket: 'tkt', roomCode: 'ABCD', gameId: 'g1' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('leaves immediately from the pre-connect back button (nothing to lose yet)', () => {
    useGame.setState({ snapshot: null, rejection: null });
    render(<GameScreen />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUi.getState().view).toBe('home');
  });

  it('confirms before leaving from the post-game ScoreBoard', () => {
    useGame.setState({ snapshot: gameOverSnap(), rejection: null });
    render(<GameScreen />);
    fireEvent.click(screen.getByText('離開遊戲'));
    expect(useUi.getState().view).toBe('game'); // unchanged until confirmed
    // ScoreBoard itself renders a role="dialog" too, so target the confirmation by its own title.
    expect(screen.getByText('離開？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(useUi.getState().view).toBe('home');
  });
});

describe('GameScreen session replaced', () => {
  beforeEach(() => {
    useUi.setState({ view: 'game', ticket: 'tkt', roomCode: 'ABCD', gameId: 'g1' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows a blocking dialog and returns home on acknowledgement', () => {
    useGame.setState({ snapshot: null, sessionReplaced: true });
    render(<GameScreen />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回首頁' }));
    expect(useUi.getState().view).toBe('home');
  });
});
