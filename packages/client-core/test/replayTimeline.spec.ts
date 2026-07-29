import { describe, it, expect } from 'vitest';
import type { Action } from '@trm/engine';
import { asPlayerId, type PlayerId, type RouteId, type TicketId } from '@trm/shared';
import { buildReplayTimeline, turnAtStep, turnBoundaries } from '../src/replay/timeline';

const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');
const seats = new Map([
  ['p1', 0],
  ['p2', 1],
]);

const keepInitial = (player: PlayerId): Action => ({
  t: 'KEEP_INITIAL_TICKETS',
  player,
  keep: ['tk1' as TicketId],
});
const draw = (player: PlayerId): Action => ({ t: 'DRAW_BLIND', player });
const claim = (player: PlayerId, routeId: string): Action => ({
  t: 'CLAIM_ROUTE',
  player,
  routeId: routeId as RouteId,
  payment: { color: 'RED', colorCount: 2, locomotives: 0 },
});
const resolveTunnel = (player: PlayerId): Action => ({ t: 'RESOLVE_TUNNEL', player, commit: true });

describe('buildReplayTimeline', () => {
  it('collapses the simultaneous opening draft into one segment', () => {
    const timeline = buildReplayTimeline([keepInitial(p1), keepInitial(p2), draw(p1)], seats);
    expect(timeline.turns[0]).toMatchObject({ from: 0, to: 2, setup: true, index: 0 });
    // ...and it does not count as a played turn.
    expect(timeline.turnCount).toBe(1);
  });

  it('groups a run of one player’s actions into a single turn', () => {
    const timeline = buildReplayTimeline(
      [draw(p1), draw(p1), draw(p2), draw(p2), claim(p1, 'r1')],
      seats,
    );
    expect(timeline.turns.map((t) => [t.from, t.to, t.seat])).toEqual([
      [0, 2, 0],
      [2, 4, 1],
      [4, 5, 0],
    ]);
    expect(timeline.turns.map((t) => t.index)).toEqual([1, 2, 3]);
  });

  it('marks claims, stations and repairs — and lets a tunnel resolve own its claim', () => {
    const timeline = buildReplayTimeline(
      [claim(p1, 'r1'), draw(p2), claim(p2, 'r2'), resolveTunnel(p2)],
      seats,
    );
    expect(timeline.moments).toEqual([
      { step: 1, kind: 'claim', player: 'p1', seat: 0 },
      { step: 4, kind: 'tunnel', player: 'p2', seat: 1 },
    ]);
  });

  it('locates the turn a step is inside, and nothing before the first action', () => {
    const timeline = buildReplayTimeline([draw(p1), draw(p1), draw(p2)], seats);
    expect(turnAtStep(timeline, 0)).toBeNull();
    expect(turnAtStep(timeline, 1)?.seat).toBe(0);
    expect(turnAtStep(timeline, 2)?.seat).toBe(0);
    expect(turnAtStep(timeline, 3)?.seat).toBe(1);
  });

  it('offers the start plus every turn end as symmetric seek targets', () => {
    const timeline = buildReplayTimeline([draw(p1), draw(p1), draw(p2)], seats);
    expect(turnBoundaries(timeline)).toEqual([0, 2, 3]);
  });

  it('survives an empty log', () => {
    const timeline = buildReplayTimeline([], seats);
    expect(timeline).toMatchObject({ turns: [], moments: [], total: 0, turnCount: 0 });
    expect(turnBoundaries(timeline)).toEqual([0]);
  });
});
