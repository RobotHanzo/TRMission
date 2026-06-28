import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, type GameEvent, type GameSnapshot } from '@trm/proto';
import { TICKETS } from '../game/content';
import { useGame } from '../store/game';
import { useAnimations } from '../store/animations';
import { useAnimationDriver } from './useAnimationDriver';

const T1 = TICKETS[0]!.id as string;
const T2 = TICKETS[1]!.id as string;

function snap(version: number, completed: { p: string; t: string }[]): GameSnapshot {
  return create(GameSnapshotSchema, {
    stateVersion: version,
    players: [{ id: 'p0', seat: 0 }],
    you: { playerId: 'p0' },
    completedTickets: completed.map((c) => ({ playerId: c.p, ticketId: c.t })),
  });
}

function Harness() {
  useAnimationDriver();
  return null;
}

describe('useAnimationDriver', () => {
  beforeEach(() => {
    useGame.getState().reset();
    useAnimations.getState().reset();
  });

  it('does not fire a fanfare for tickets already complete on the first snapshot', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, [{ p: 'p0', t: T1 }])));
    expect(useAnimations.getState().fanfare).toBeNull();
  });

  it('fires a fanfare + score float when a new ticket completes for me', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, [{ p: 'p0', t: T1 }])));
    act(() => useGame.getState().applySnapshot(snap(2, [{ p: 'p0', t: T1 }, { p: 'p0', t: T2 }])));
    expect(useAnimations.getState().fanfare?.ticketId).toBe(T2);
    expect(useAnimations.getState().floats.length).toBeGreaterThan(0);
  });

  it('turns an event batch into intents (RouteClaimed → glow)', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, [])));
    const ev: GameEvent = {
      event: { case: 'routeClaimed', value: { playerId: 'p0', routeId: 'R1', pointsAwarded: 2 } },
    } as GameEvent;
    act(() => useGame.getState().applyEvents(2, [ev]));
    expect(useAnimations.getState().glowingRoutes.get('R1')).toBe(0);
  });
});
