// Mirrors useSoundDriver.test.tsx: real GameSnapshots via create(GameSnapshotSchema), a mocked
// soundPlayer, and the game store driven directly. Fake timers drive the countdown ticking.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import { useGame } from '../store/game';
import { TurnCountdown } from './TurnCountdown';

const { play } = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock('../sound/player', () => ({ soundPlayer: { play } }));

function snap(me: string, phase?: Phase): GameSnapshot {
  return create(GameSnapshotSchema, {
    stateVersion: 1,
    players: [{ id: me, seat: 0 }],
    you: { playerId: me },
    ...(phase === undefined ? {} : { phase }),
  });
}

beforeEach(() => {
  play.mockClear();
  useGame.getState().reset();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('TurnCountdown (issue #13)', () => {
  it('renders nothing when nobody is on the clock', () => {
    act(() => useGame.getState().applySnapshot(snap('me')));
    const { container } = render(<TurnCountdown />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the remaining seconds and fires the lapsed cue for the local player', () => {
    act(() => useGame.getState().applySnapshot(snap('me')));
    act(() => useGame.getState().applyTurnTimer('me', 3_000, 75_000));
    render(<TurnCountdown />);
    expect(screen.getByRole('timer').textContent).toContain('3');

    // Jump past the deadline; the 200ms interval then observes zero and rings the lapse cue once.
    act(() => {
      vi.setSystemTime(1_004_000);
      vi.advanceTimersByTime(400);
    });
    expect(play).toHaveBeenCalledWith('countdownLapsed');
  });

  it('stays silent when the countdown belongs to another player', () => {
    act(() => useGame.getState().applySnapshot(snap('me')));
    act(() => useGame.getState().applyTurnTimer('opponent', 1_000, 75_000));
    render(<TurnCountdown />);
    act(() => {
      vi.setSystemTime(1_002_000);
      vi.advanceTimersByTime(400);
    });
    expect(play).not.toHaveBeenCalled();
  });

  it('renders nothing once the game is over even if a stale timer lingers', () => {
    act(() => useGame.getState().applyTurnTimer('me', 10_000, 75_000));
    act(() => useGame.getState().applySnapshot(snap('me', Phase.GAME_OVER)));
    const { container } = render(<TurnCountdown />);
    expect(container.firstChild).toBeNull();
  });
});
