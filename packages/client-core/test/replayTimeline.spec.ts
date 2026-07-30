import { describe, it, expect } from 'vitest';
import type { Action } from '@trm/engine';
import { asPlayerId, type CityId, type PlayerId, type RouteId, type TicketId } from '@trm/shared';
import { buildReplayTimeline, turnAtStep, roundBoundaries } from '../src/replay/timeline';

const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');
const p3 = asPlayerId('p3');
const seats = new Map([
  ['p1', 0],
  ['p2', 1],
  ['p3', 2],
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
const resolveTunnel = (player: PlayerId, commit = true): Action => ({
  t: 'RESOLVE_TUNNEL',
  player,
  commit,
});
const buildStation = (player: PlayerId): Action => ({
  t: 'BUILD_STATION',
  player,
  cityId: 'c1' as CityId,
  payment: { color: 'RED', colorCount: 1, locomotives: 0 },
});

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

  it('marks only the rare moments — stations and tunnels, never everyday claims', () => {
    const timeline = buildReplayTimeline(
      [claim(p1, 'r1'), draw(p2), buildStation(p2), claim(p1, 'r2'), resolveTunnel(p1)],
      seats,
    );
    expect(timeline.moments).toEqual([
      { step: 3, kind: 'station', player: 'p2', seat: 1 },
      { step: 5, kind: 'tunnel', player: 'p1', seat: 0 },
    ]);
  });

  it('counts track laid per turn, once for a tunnel and not at all when it is aborted', () => {
    const timeline = buildReplayTimeline(
      [
        claim(p1, 'r1'), // a plain claim
        claim(p1, 'r2'),
        resolveTunnel(p1), // a bore committed: still one route
        draw(p2),
        claim(p2, 'r3'),
        resolveTunnel(p2, false), // backed out: no track went down
      ],
      seats,
    );
    expect(timeline.turns.map((t) => t.track)).toEqual([2, 0]);
  });

  it('leaves a card-drawing turn with no track', () => {
    const timeline = buildReplayTimeline([draw(p1), draw(p1)], seats);
    expect(timeline.turns[0]?.track).toBe(0);
  });

  it('locates the turn a step is inside, and nothing before the first action', () => {
    const timeline = buildReplayTimeline([draw(p1), draw(p1), draw(p2)], seats);
    expect(turnAtStep(timeline, 0)).toBeNull();
    expect(turnAtStep(timeline, 1)?.seat).toBe(0);
    expect(turnAtStep(timeline, 2)?.seat).toBe(0);
    expect(turnAtStep(timeline, 3)?.seat).toBe(1);
  });

  it('numbers rounds off the anchor — the first player to take a turn', () => {
    const timeline = buildReplayTimeline(
      [
        keepInitial(p1),
        keepInitial(p2),
        keepInitial(p3),
        draw(p1),
        draw(p2),
        draw(p3),
        draw(p1),
        draw(p2), // the endgame cuts round 2 short — p3 never plays it
      ],
      seats,
    );
    expect(timeline.turns.map((t) => t.round)).toEqual([0, 1, 1, 1, 2, 2]);
    expect(timeline.roundCount).toBe(2);
  });

  it('keeps rounds honest when turn order reverses mid-game', () => {
    // The reversal event flips the cursor rather than restarting it, so the seats walk back down
    // (p1,p2,p3,p2,p1) and the round still turns over exactly where the engine bumps roundIndex:
    // when the cursor lands back on the anchor.
    const timeline = buildReplayTimeline([draw(p1), draw(p2), draw(p3), draw(p2), draw(p1)], seats);
    expect(timeline.turns.map((t) => t.round)).toEqual([1, 1, 1, 1, 2]);
  });

  it('offers the start, the draft and every round end as symmetric seek targets', () => {
    const timeline = buildReplayTimeline(
      [
        keepInitial(p1),
        keepInitial(p2),
        draw(p1),
        draw(p1),
        draw(p2),
        claim(p1, 'r1'), // opens round 2
        draw(p2),
      ],
      seats,
    );
    // 0 → end of the opening draft → end of round 1 → end of round 2 (the log's end).
    expect(roundBoundaries(timeline)).toEqual([0, 2, 5, 7]);
  });

  it('survives an empty log', () => {
    const timeline = buildReplayTimeline([], seats);
    expect(timeline).toMatchObject({
      turns: [],
      moments: [],
      total: 0,
      turnCount: 0,
      roundCount: 0,
    });
    expect(roundBoundaries(timeline)).toEqual([0]);
  });
});
