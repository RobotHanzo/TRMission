import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameEvent, type GameSnapshot } from '@trm/proto';
import { TICKETS } from '../game/content';
import { useGame } from '../store/game';
import { useAnimations } from '../store/animations';
import { useAnimationDriver } from './useAnimationDriver';
import i18n from '../i18n';

const T1 = TICKETS[0]!.id as string;
const T2 = TICKETS[1]!.id as string;

function snap(version: number, completed: { p: string; t: string }[], phase?: Phase): GameSnapshot {
  return create(GameSnapshotSchema, {
    stateVersion: version,
    ...(phase === undefined ? {} : { phase }),
    players: [{ id: 'p0', seat: 0 }],
    you: { playerId: 'p0' },
    completedTickets: completed.map((c) => ({ playerId: c.p, ticketId: c.t })),
  });
}

function endgameSnap(version: number, triggered: boolean, triggerIndex = 1): GameSnapshot {
  return create(GameSnapshotSchema, {
    stateVersion: version,
    players: [
      { id: 'p0', seat: 0 },
      { id: 'p1', seat: 1 },
    ],
    you: { playerId: 'p0' },
    turnOrder: ['p0', 'p1'],
    endgame: {
      triggered,
      triggerPlayerIndex: triggered ? triggerIndex : -1,
      finalTurnsRemaining: 2,
    },
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
    act(() =>
      useGame.getState().applySnapshot(
        snap(2, [
          { p: 'p0', t: T1 },
          { p: 'p0', t: T2 },
        ]),
      ),
    );
    expect(useAnimations.getState().fanfare?.ticketId).toBe(T2);
    expect(useAnimations.getState().floats.length).toBeGreaterThan(0);
  });

  it('reveals covered market slots when a draw finishes (phase leaves DRAWING_CARDS)', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, [], Phase.DRAWING_CARDS)));
    act(() => useAnimations.getState().pushIntent({ kind: 'marketCover', slot: 3 }));
    expect(useAnimations.getState().coveredMarketSlots.has(3)).toBe(true);
    act(() => useGame.getState().applySnapshot(snap(2, [], Phase.AWAIT_ACTION)));
    const s = useAnimations.getState();
    expect(s.coveredMarketSlots.size).toBe(0);
    expect(s.marketFlips.has(3)).toBe(true);
  });

  it('does not warn when the first snapshot is already in the final round (reconnect)', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(endgameSnap(1, true)));
    expect(useAnimations.getState().endgameCue).toBeNull();
  });

  it('pops the final-round warning when the endgame triggers, flagging who caused it', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(endgameSnap(1, false)));
    expect(useAnimations.getState().endgameCue).toBeNull();
    // p1 (not me) runs their trains down → warning fires, not attributed to me.
    act(() => useGame.getState().applySnapshot(endgameSnap(2, true, 1)));
    expect(useAnimations.getState().endgameCue?.triggeredByYou).toBe(false);
  });

  it('attributes the final-round trigger to me when I cause it', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(endgameSnap(1, false)));
    act(() => useGame.getState().applySnapshot(endgameSnap(2, true, 0)));
    expect(useAnimations.getState().endgameCue?.triggeredByYou).toBe(true);
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

  it('notifies me when my turn opens straight into a forced ticket re-draw', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, [])));
    const turnStarted: GameEvent = {
      event: { case: 'turnStarted', value: { playerId: 'p0', orderIndex: 0 } },
    } as GameEvent;
    const ticketsOffered: GameEvent = {
      event: { case: 'ticketsOffered', value: { playerId: 'p0', ticketIds: [T1] } },
    } as GameEvent;
    act(() => useGame.getState().applyEvents(2, [turnStarted, ticketsOffered]));
    const notifications = useAnimations.getState().notifications;
    expect(
      notifications.some((n) => n.variant === 'success' && n.text === i18n.t('forcedTicketRedraw')),
    ).toBe(true);
  });

  it('does not notify for a voluntary mid-turn ticket draw (no accompanying turnStarted)', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, [])));
    const ticketsOffered: GameEvent = {
      event: { case: 'ticketsOffered', value: { playerId: 'p0', ticketIds: [T1] } },
    } as GameEvent;
    act(() => useGame.getState().applyEvents(2, [ticketsOffered]));
    const notifications = useAnimations.getState().notifications;
    expect(notifications.some((n) => n.variant === 'success')).toBe(false);
  });
});
