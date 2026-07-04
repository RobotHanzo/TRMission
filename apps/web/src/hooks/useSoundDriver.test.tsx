// Follows the repo convention (see useAnimationDriver.test.tsx): a <Harness/> component, real
// snapshots via create(GameSnapshotSchema), and useGame.getState().applySnapshot/applyEvents.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import { useGame } from '../store/game';
import { useChat } from '../store/chat';
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

function Harness({ sandbox }: { sandbox?: boolean } = {}) {
  useSoundDriver(sandbox);
  return null;
}

beforeEach(() => {
  play.mockClear();
  useGame.getState().reset();
  useChat.getState().reset();
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

  it('plays yourTurn on a turnStarted event for me', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    const ev: GameEvent = { event: { case: 'turnStarted', value: { playerId: 'p0' } } } as GameEvent;
    act(() => useGame.getState().applyEvents(2, [ev]));
    expect(play).toHaveBeenCalledWith('yourTurn', 1);
  });

  it('suppresses yourTurn in sandbox mode (encyclopedia/replay loops)', () => {
    render(<Harness sandbox />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    const ev: GameEvent = { event: { case: 'turnStarted', value: { playerId: 'p0' } } } as GameEvent;
    act(() => useGame.getState().applyEvents(2, [ev]));
    expect(play).not.toHaveBeenCalledWith('yourTurn', expect.anything());
  });

  it('plays eventStart at full gain when a random event starts', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    const ev: GameEvent = {
      event: { case: 'randomEventStarted', value: { info: { kind: 'TYPHOON_LANDFALL' } } },
    } as unknown as GameEvent;
    act(() => useGame.getState().applyEvents(2, [ev]));
    expect(play).toHaveBeenCalledWith('eventStart', 1);
  });

  it('plays chatMessage for an incoming message (opponent attenuated)', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    act(() => useChat.getState().ingest({ playerId: 'p1', text: 'hi' }));
    expect(play).toHaveBeenCalledWith('chatMessage', 0.5);
  });

  it('plays chatMessage at full gain for my own message', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    act(() => useChat.getState().ingest({ playerId: 'p0', text: 'hi' }));
    expect(play).toHaveBeenCalledWith('chatMessage', 1);
  });

  it('does not replay chatMessage from a reconnect history backfill', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, {})));
    act(() => useChat.getState().ingestHistory([{ playerId: 'p1', text: 'old' }]));
    expect(play).not.toHaveBeenCalledWith('chatMessage', expect.anything());
  });
});
