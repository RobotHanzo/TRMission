import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { GameScreen } from './GameScreen';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';

vi.mock('../net/connection', () => ({ connectGame: vi.fn(), getSocket: () => null }));
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
    expect(screen.getByRole('button', { name: /抽任務卡/ })).toBeDisabled();
  });
});
