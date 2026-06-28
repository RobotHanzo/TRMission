// Follows the repo convention (see useAnimationDriver.test.tsx): a <Harness/> component, real
// snapshots via create(GameSnapshotSchema), and useGame.getState().applySnapshot/applyEvents.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import { useGame } from '../store/game';
import { useSoundDriver } from './useSoundDriver';

const { play } = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock('../sound/player', () => ({
  soundPlayer: {
    preload: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn(),
    play,
    setEnabled: vi.fn(),
    setVolume: vi.fn(),
  },
}));

function snap(
  version: number,
  opts: { phase?: Phase; completed?: { p: string; t: string }[]; winners?: string[] } = {},
): GameSnapshot {
  return create(GameSnapshotSchema, {
    stateVersion: version,
    players: [
      { id: 'p0', seat: 0 },
      { id: 'p1', seat: 1 },
    ],
    you: { playerId: 'p0' },
    ...(opts.phase === undefined ? {} : { phase: opts.phase }),
    completedTickets: (opts.completed ?? []).map((c) => ({ playerId: c.p, ticketId: c.t })),
    ...(opts.winners ? { finalScores: { ranking: [{ playerIds: opts.winners }] } } : {}),
  });
}

function Harness() {
  useSoundDriver();
  return null;
}

beforeEach(() => {
  play.mockClear();
  useGame.getState().reset();
});

describe('useSoundDriver', () => {
  it('does not fire game-over on the first snapshot (resume safety)', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, { phase: Phase.GAME_OVER, winners: ['p0'] })));
    expect(play).not.toHaveBeenCalledWith('gameOverWin');
  });

  it('fires gameOverWin on the transition into GAME_OVER', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    act(() => useGame.getState().applySnapshot(snap(2, { phase: Phase.GAME_OVER, winners: ['p0'] })));
    expect(play).toHaveBeenCalledWith('gameOverWin');
  });

  it('plays card-draw cues from an event batch (opponent attenuated)', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    const ev: GameEvent = {
      event: { case: 'cardDrawnBlind', value: { playerId: 'p1' } },
    } as GameEvent;
    act(() => useGame.getState().applyEvents(2, [ev]));
    expect(play).toHaveBeenCalledWith('cardDraw', 0.5);
  });

  it('plays missionComplete when a kept ticket newly completes for me', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    act(() => useGame.getState().applySnapshot(snap(2, { completed: [{ p: 'p0', t: 't1' }] })));
    expect(play).toHaveBeenCalledWith('missionComplete');
  });
});
